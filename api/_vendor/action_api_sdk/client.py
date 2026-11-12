"""High-level client for action-api-sdk (WAPI skill + algorithm invoke)."""

import json
import os
import tempfile
from copy import deepcopy
from pathlib import Path
from typing import Any, Callable, Dict, Optional, Tuple
from urllib.parse import urlencode

import requests

from .agent_info import agent_headers, resolve_agent_info
from .ai import api
from .request_debug import debug_request
from .sign_sdk import sign
from . import config as app_config


_UPGRADE_NOTICE_CODE = "skill_upgrade_available"


def _load_env_file():
    """Load environment variables from the package or working-directory .env."""
    env_path = Path(__file__).resolve().parent / ".env"
    if not env_path.exists():
        env_path = Path.cwd() / ".env"

    if env_path.exists():
        with open(env_path, "r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line or line.startswith("#"):
                    continue
                if "=" in line:
                    key, value = line.split("=", 1)
                    key = key.strip()
                    value = value.strip().strip("\"'")
                    if key and key not in os.environ:
                        os.environ[key] = value


_load_env_file()


def _wapi_meta_code_value(meta_code: Any) -> int:
    """Normalize meta.code for comparisons (int)."""
    if meta_code is None:
        return 0
    if meta_code == 0 or meta_code == "0":
        return 0
    try:
        return int(meta_code)
    except (TypeError, ValueError):
        return -1


def _normalize_notices(payload):
    """Return valid user-facing notices from a WAPI response or response envelope."""
    if not isinstance(payload, dict):
        return []
    response = payload.get("response")
    if isinstance(response, dict):
        payload = response
    raw_notices = payload.get("notices")
    if not isinstance(raw_notices, list):
        return []

    notices = []
    for item in raw_notices:
        if not isinstance(item, dict):
            continue
        message = str(item.get("message") or "").strip()
        if not message:
            continue
        notice = deepcopy(item)
        notice["message"] = message
        if notice.get("code") is not None:
            notice["code"] = str(notice["code"]).strip()
        notices.append(notice)
    return notices


class WapiApiError(RuntimeError):
    """HTTP 200 but WAPI meta.code != 0."""

    def __init__(self, code: int, msg: str, raw: Dict, *, original_code=None):
        self.code = code
        self.original_code = original_code if original_code is not None else code
        self.msg = msg or "Request failed"
        self.raw = raw if isinstance(raw, dict) else {}
        self.notices = _normalize_notices(self.raw)
        super().__init__(f"[{self.original_code}] {self.msg}")


class ConsumeDeniedError(WapiApiError):
    """Non-zero meta from POST /skill/consume.json (quota / permission)."""


class ConfigFetchError(WapiApiError):
    """Non-zero meta from POST /skill/config.json."""


def _catalog_items(value):
    """Yield catalog keys and records from supported dict/list response shapes."""
    if isinstance(value, dict):
        nested = value.get("items")
        if isinstance(nested, list):
            value = nested
        else:
            for key, item in value.items():
                if isinstance(item, dict):
                    yield str(key), item
            return

    if isinstance(value, list):
        for item in value:
            if not isinstance(item, dict):
                continue
            key = item.get("material_id") or item.get("id")
            if key is not None and str(key).strip():
                yield str(key).strip(), item


def normalize_task_catalog(response):
    """Normalize the server-selected config schema into a task catalog.

    A recognized ``schema`` is authoritative. Responses from older servers that
    omit it keep the existing catalog-metadata inference for compatibility. An
    unknown explicit schema fails closed instead of guessing its structure.
    """
    if not isinstance(response, dict):
        return {"mode": "unavailable", "source": None, "entries": []}

    algorithm = response.get("algorithm")
    if not isinstance(algorithm, dict):
        algorithm = {}
    invoke = algorithm.get("invoke")
    if not isinstance(invoke, dict):
        invoke = {}

    schema = str(response.get("schema") or "").strip().lower()
    if schema and schema not in {"v1", "v2"}:
        return {"mode": "unavailable", "source": "schema", "entries": []}

    source = None
    raw_catalog = None
    for owner_name, owner in (("response", response), ("algorithm", algorithm)):
        for field in ("catalog", "materials"):
            candidate = owner.get(field)
            if isinstance(candidate, (dict, list)) and candidate:
                source = f"{owner_name}.{field}"
                raw_catalog = candidate
                break
        if raw_catalog is not None:
            break

    if schema == "v1":
        source = "algorithm.invoke" if invoke else None
        items = list(_catalog_items(invoke))
        mode = "legacy"
    elif schema == "v2":
        if raw_catalog is not None:
            items = list(_catalog_items(raw_catalog))
        else:
            source = "algorithm.invoke" if invoke else None
            items = list(_catalog_items(invoke))
        mode = "v2"
    elif raw_catalog is not None:
        mode = "v2"
        items = list(_catalog_items(raw_catalog))
    else:
        source = "algorithm.invoke" if invoke else None
        items = list(_catalog_items(invoke))
        metadata_fields = {"material_id", "name", "description", "media_type"}
        mode = (
            "v2"
            if any(metadata_fields.intersection(item.keys()) for _, item in items)
            else "legacy"
            if items
            else "unavailable"
        )

    entries = []
    for key, catalog_spec in items:
        runtime_spec = invoke.get(key)
        if not isinstance(runtime_spec, dict):
            runtime_spec = {}
        spec = {**runtime_spec, **catalog_spec}
        material_id = key.strip()
        if not material_id:
            continue
        name = str(spec.get("name") or "").strip()
        description = str(spec.get("description") or "").strip()
        params = spec.get("params")
        if params is None:
            params = {}
        entry = {
            "material_id": material_id,
            "name": name,
            "description": description,
            "media_type": str(spec.get("media_type") or "").strip().lower(),
            "task": str(spec.get("task") or "").strip(),
            "task_type": str(spec.get("task_type") or "").strip(),
            "params": deepcopy(params),
        }
        if spec.get("profile") is not None:
            entry["profile"] = deepcopy(spec["profile"])
        entries.append(entry)

    return {"mode": mode, "source": source, "entries": entries}


def public_catalog(catalog: dict, media_type: str = "") -> dict:
    """Expose task-selection fields, including the V2 execution identity."""
    mode = catalog.get("mode")
    requested_media = (media_type or "").strip().lower()
    tasks = []
    for entry in catalog.get("entries") or []:
        entry_media = entry.get("media_type") or ""
        if requested_media and entry_media and entry_media != requested_media:
            continue
        if mode == "v2":
            name = entry.get("name")
            if not name:
                continue
            item = {
                "material_id": entry.get("material_id"),
                "name": name,
                "description": entry.get("description"),
                "media_type": entry_media,
            }
        else:
            item = {
                "task_name": entry.get("material_id"),
                "media_type": entry_media,
            }
        tasks.append(item)
    return {
        "skill_status": "ready",
        "config_mode": mode,
        "catalog_source": catalog.get("source"),
        "tasks": tasks,
        "count": len(tasks),
        "agent_instruction": (
            "V2: select by name, description, and media_type, then pass the exact "
            "returned material_id to --task. Present name, description, and localized "
            "media_type to the user. Legacy: use an alias only if it "
            "appears in tasks. Never fall back to a local task name when catalog "
            "discovery fails."
        ),
    }


class WapiClient:
    """Client for signed WAPI requests."""

    def __init__(
        self,
        ak,
        sk,
        endpoint=None,
        *,
        agent_name=None,
        agent_version=None,
        agent_model=None,
    ):
        """
        :param ak: Access Key
        :param sk: Secret Key
        :param endpoint: optional WAPI host; defaults to WAPI_ENDPOINT or config
        """
        self.ak = ak
        self.sk = sk
        self.endpoint = (
            endpoint
            or os.environ.get("WAPI_ENDPOINT")
            or app_config.WAPI_ENDPOINT
        )
        self.agent_info = resolve_agent_info(
            agent_name,
            agent_version,
            agent_model,
        )

    def _debug_request(self, method, uri, headers, body=""):
        debug_request(method, uri, headers, body)

    def request(self, path, method="GET", params=None, body=None):
        """
        Send a signed request to WAPI.

        :return: the JSON ``response`` field
        :raises WapiApiError: HTTP 200 with a non-zero meta.code
        :raises RuntimeError: HTTP or transport failure
        """
        query_string = urlencode(params) if params else ""
        uri = f"https://{self.endpoint}{path}"
        if query_string:
            uri = f"{uri}?{query_string}"

        try:
            signer = sign.Signer(self.ak, self.sk)
            headers = {
                "User-Agent": getattr(app_config, "USER_AGENT", "action-api-sdk-v1.0.0"),
            }
            headers.update(agent_headers(self.agent_info, app_config.VERSION))

            body_str = ""
            if body:
                headers["Content-Type"] = "application/json"
                body_str = json.dumps(body)

            signed_request = signer.sign(uri, method, headers, body_str)
            self._debug_request(method, uri, headers, body_str)

            session = requests.Session()
            resp = session.send(signed_request, timeout=10)

            if resp.status_code != 200:
                raise RuntimeError(
                    f"Request failed: status={resp.status_code}, path={path}"
                )

            data = json.loads(resp.content)
            meta = data.get("meta", {}) or {}
            if _wapi_meta_code_value(meta.get("code", 0)) != 0:
                msg = meta.get("msg", "Request failed")
                raise WapiApiError(
                    _wapi_meta_code_value(meta.get("code", 0)),
                    msg,
                    data,
                    original_code=meta.get("code"),
                )
            return data.get("response", {})
        except (WapiApiError, RuntimeError):
            raise
        except Exception as e:
            raise RuntimeError(
                f"Request error: {type(e).__name__}, path={path}"
            ) from e


class SkillClient:
    """Client for remote config, catalog, quota consumption, upload, and invoke.

    Example:
        client = SkillClient()
        catalog = client.get_task_catalog()
        result = client.run_task("SKM0001", "/path/to/image.jpg")
    """

    def __init__(
        self,
        ak=None,
        sk=None,
        region="cn-north-4",
        oss_region=None,
        auto_fetch_config=True,
        *,
        agent_name=None,
        agent_version=None,
        agent_model=None,
    ):
        self.ak = ak or os.environ.get("MT_AK")
        self.sk = sk or os.environ.get("MT_SK")

        if not self.ak or not self.sk:
            raise ValueError(
                "AK and SK must be provided as arguments or via MT_AK/MT_SK"
            )

        self._pipeline_trace: list = []
        self._notices: list = []
        self._notice_keys: set = set()
        self.wapi = WapiClient(
            self.ak,
            self.sk,
            agent_name=agent_name,
            agent_version=agent_version,
            agent_model=agent_model,
        )
        self.api = api.AiApi(self.ak, self.sk, region, oss_region)
        self.config_response = None
        self.task_catalog = None

        if auto_fetch_config:
            self.fetch_config()

    def fetch_config(self, gid=None, version=None):
        """Fetch skill configuration and update the SDK, including the V2 catalog."""
        if version is None:
            version = getattr(app_config, "VERSION", "v2.0.1")

        if not gid:
            cached_gid = self._get_cached_gid()
            if cached_gid:
                gid = cached_gid

        supported = list(getattr(app_config, "SUPPORTED_SCHEMAS", ("v2", "v1")))
        try:
            response = self.wapi.request(
                "/skill/config.json",
                method="POST",
                body={
                    "gid": gid or "",
                    "version": version or "",
                    "supported_schemas": supported,
                },
            )
        except WapiApiError as e:
            raise ConfigFetchError(
                e.code, e.msg, e.raw, original_code=e.original_code
            ) from e
        except RuntimeError as e:
            raise ConfigFetchError(
                -1,
                "Failed to fetch skill config (check network, AK/SK, and server). "
                "Detail: " + str(e),
                {},
            ) from e

        if response.get("gid"):
            self._cache_gid(response["gid"])

        self._collect_notices(response)
        has_upgrade_notice = any(
            notice.get("code") == _UPGRADE_NOTICE_CODE for notice in self._notices
        )
        if response.get("need_update") and not has_upgrade_notice:
            message = response.get(
                "update_message", "A newer version is available. Please upgrade."
            )
            latest = str(response.get("latest_version") or "").strip()
            self._collect_notices(
                {
                    "notices": [
                        {
                            "code": _UPGRADE_NOTICE_CODE,
                            "level": "warning",
                            "message": message,
                            "dedupe_key": _UPGRADE_NOTICE_CODE + ":" + latest,
                        }
                    ]
                }
            )

        self._update_config_from_response(response)
        self.config_response = response
        self.task_catalog = normalize_task_catalog(response)
        if self.task_catalog["mode"] == "v2":
            for entry in self.task_catalog["entries"]:
                if not entry["task"]:
                    continue
                runtime_spec = {
                    "task": entry["task"],
                    "task_type": entry["task_type"],
                    "params": deepcopy(entry["params"]),
                }
                if "profile" in entry:
                    runtime_spec["profile"] = deepcopy(entry["profile"])
                app_config.INVOKE[entry["material_id"]] = runtime_spec

        return response

    def _collect_notices(self, payload):
        added = 0
        for notice in _normalize_notices(payload):
            key = str(
                notice.get("dedupe_key")
                or (str(notice.get("code") or "") + ":" + notice["message"])
            )
            if key in self._notice_keys:
                continue
            self._notice_keys.add(key)
            self._notices.append(notice)
            added += 1
        return added

    def get_notices(self):
        return deepcopy(self._notices)

    def _attach_notices(self, result):
        if not isinstance(result, dict):
            return result
        out = dict(result)
        self._collect_notices(result)
        if self._notices:
            out["notices"] = self.get_notices()
        return out

    def get_task_catalog(self, *, refresh=False):
        """Return the normalized remote task catalog, fetching it when needed."""
        if refresh or self.task_catalog is None:
            self.fetch_config()
        return deepcopy(self.task_catalog)

    def resolve_task(self, task_name):
        """Resolve only a task advertised by the successfully fetched config."""
        requested = str(task_name or "").strip()
        catalog = self.get_task_catalog()
        mode = catalog.get("mode")
        entries = catalog.get("entries") or []
        if mode == "v2":
            for entry in entries:
                if entry.get("material_id") == requested:
                    return entry
            matches = [entry for entry in entries if entry.get("name") == requested]
            if len(matches) == 1:
                return matches[0]
            if len(matches) > 1:
                raise KeyError(
                    f"V2 task name {requested!r} is ambiguous in remote config; "
                    "use the exact material_id returned by catalog."
                )
            raise KeyError(
                f"Unknown V2 task selector {requested!r}; run catalog "
                "and use an exact returned material_id."
            )
        if mode == "legacy":
            for entry in entries:
                if entry.get("material_id") == requested:
                    return entry
            raise KeyError(
                f"Legacy task {requested!r} was not returned by remote config; "
                "local fallback is disabled."
            )
        raise RuntimeError(
            "Remote config did not provide a usable V2 catalog or legacy invoke map."
        )

    def _gid_cache_path(self):
        cache_file = getattr(app_config, "GID_CACHE_FILE", "~/.cache/mtai/gid_cache.json")
        # Keep a stable companion path for the simple gid.json used historically.
        base = os.path.dirname(os.path.expanduser(cache_file))
        return os.path.join(base or os.path.expanduser("~/.cache/mtai"), "gid.json")

    def _get_cached_gid(self):
        cache_file = self._gid_cache_path()
        if os.path.exists(cache_file):
            try:
                with open(cache_file, "r", encoding="utf-8") as f:
                    data = json.load(f)
                    return data.get("gid")
            except (json.JSONDecodeError, IOError):
                return None
        return None

    def _cache_gid(self, gid):
        cache_file = self._gid_cache_path()
        try:
            os.makedirs(os.path.dirname(cache_file), exist_ok=True)
            with open(cache_file, "w", encoding="utf-8") as f:
                json.dump({"gid": gid}, f, ensure_ascii=False, indent=2)
        except IOError:
            pass

    def _update_config_from_response(self, response):
        if "algorithm" not in response:
            return

        algo = response["algorithm"]

        if "regions" in algo:
            self.api._config["regions"].update(algo["regions"])
            if self.api.region in algo["regions"]:
                self.api.EndPoint = algo["regions"][self.api.region]

        if "token_policy_type" in algo:
            self.api._config["token_policy_type"] = algo["token_policy_type"]

        if "token_policy_types" in algo:
            self.api._config["token_policy_types"] = algo["token_policy_types"]

        if "invoke" in algo:
            app_config.INVOKE.update(algo["invoke"])

    def _consume_permission(self, url, task):
        gid = self._get_cached_gid()
        try:
            response = self.wapi.request(
                "/skill/consume.json",
                method="POST",
                body={"url": url, "task": task, "gid": gid or ""},
            )
            self._collect_notices(response)
            return response
        except WapiApiError as e:
            self._collect_notices({"notices": e.notices})
            raise ConsumeDeniedError(
                e.code, e.msg, e.raw, original_code=e.original_code
            ) from e

    def _fetch_http_input_to_tempfile(self, url: str) -> Tuple[str, int]:
        """Download URL to a temp file. Caller must unlink path."""
        try:
            with requests.get(url, stream=True, timeout=60) as resp:
                resp.raise_for_status()
                fd, path = tempfile.mkstemp(prefix="action_api_in_", suffix=".bin")
                total = 0
                try:
                    with os.fdopen(fd, "wb") as out:
                        for chunk in resp.iter_content(chunk_size=65536):
                            if not chunk:
                                continue
                            total += len(chunk)
                            out.write(chunk)
                except Exception:
                    try:
                        os.unlink(path)
                    except OSError:
                        pass
                    raise
                if total == 0:
                    try:
                        os.unlink(path)
                    except OSError:
                        pass
                    raise RuntimeError("Input URL returned empty body.")
                return path, total
        except requests.RequestException as e:
            status = getattr(getattr(e, "response", None), "status_code", None)
            detail = f" (status={status})" if status is not None else ""
            raise RuntimeError(f"Input URL download failed{detail}.") from e

    def run_task(
        self,
        task_name,
        image_path,
        params=None,
        on_async_submitted=None,
        profile=None,
    ):
        """
        Upload media and run an algorithm task after catalog resolution and consume.

        :param task_name: V2 material_id, unique name, or legacy alias
        :param image_path: local path or HTTP(S) URL
        :param params: optional task parameters
        :param profile: optional input-profile overrides
        :param on_async_submitted: callback invoked after asynchronous submission
        """
        self._pipeline_trace = []
        selection = self.resolve_task(task_name)
        resolved_task = selection.get("material_id")
        display_task = selection.get("name") or str(task_name or "").strip()
        self._pipeline_trace.append(
            {
                "step": "resolve_remote_task",
                "config_mode": (self.task_catalog or {}).get("mode"),
                "task": display_task,
                "media_type": selection.get("media_type"),
            }
        )

        if isinstance(image_path, str) and image_path.startswith(("http://", "https://")):
            tmp_path, n = self._fetch_http_input_to_tempfile(image_path)
            try:
                self._pipeline_trace.append(
                    {"step": "download_input", "source": "remote_url", "bytes": n}
                )
                url = self.api.getFileUrl(tmp_path)
            finally:
                try:
                    os.unlink(tmp_path)
                except OSError:
                    pass
        else:
            url = self.api.getFileUrl(image_path)
            self._pipeline_trace.append(
                {
                    "step": "upload_input",
                    "via": "oss_put_object",
                    "source": "local_file",
                }
            )

        if url is None:
            raise RuntimeError("Failed to upload input media")

        consume_info = self._consume_permission(url, resolved_task)
        context = consume_info.get("context", "") if consume_info else ""
        self._pipeline_trace.append({"step": "consume_quota", "task": display_task})

        invoke_kwargs = {}
        if on_async_submitted is not None:
            invoke_kwargs["on_async_submitted"] = on_async_submitted
        if profile is not None:
            invoke_kwargs["profile"] = profile
        result = self.api.invoke_task(
            resolved_task, url, params, context, **invoke_kwargs
        )
        return self._attach_notices(result)

    def poll_task_status(self, task_id):
        """Resume status polling for an existing async task (no upload / consume)."""
        tid = (task_id or "").strip()
        if not tid:
            raise ValueError("task_id is required")
        self._pipeline_trace = [
            {
                "step": "resume_poll",
                "description": "No input download, OSS upload, or consume; algorithm status GET only",
            }
        ]
        policy = self.api.getAiStrategy()
        if not policy:
            raise RuntimeError(
                "Failed to load AI token policy (check network, AK/SK, and fetch_config)."
            )
        return self._attach_notices(self.api.status(tid, policy))
