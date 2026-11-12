import copy
import json
import os
import requests
import datetime
import time
from urllib.parse import urlparse

import alibabacloud_oss_v2 as oss
from ..request_debug import debug_request
from ..sign_sdk import sign
from .gid_cache import GidCache

# Minimum total sleep between status polls (ms) when policy durations sum is shorter.
MIN_STATUS_POLL_SLEEP_MS = 60 * 60 * 1000
DEFAULT_STATUS_POLL_STEP_MS = 60 * 1000


def _parse_status_query_intervals_ms(loops):
    """Comma-separated milliseconds from policy; skips empty/invalid tokens."""
    if loops is None:
        return []
    out = []
    for part in str(loops).split(","):
        part = part.strip()
        if not part:
            continue
        try:
            out.append(int(part))
        except ValueError:
            continue
    return out


def _ensure_min_status_poll_sleep_ms(intervals):
    """
    If sum(intervals) < MIN_STATUS_POLL_SLEEP_MS, append steps (last interval,
    or DEFAULT_STATUS_POLL_STEP_MS if empty) until the sum reaches the minimum.
    """
    intervals = list(intervals)
    total = sum(intervals)
    if total >= MIN_STATUS_POLL_SLEEP_MS:
        return intervals
    step = intervals[-1] if intervals else DEFAULT_STATUS_POLL_STEP_MS
    if step <= 0:
        step = DEFAULT_STATUS_POLL_STEP_MS
    while sum(intervals) < MIN_STATUS_POLL_SLEEP_MS:
        remaining = MIN_STATUS_POLL_SLEEP_MS - sum(intervals)
        intervals.append(min(step, remaining))
    return intervals


def _normalize_oss_endpoint(url):
    """Ensure endpoint is https://host with no path."""
    if not url:
        return url
    u = url.strip()
    if "://" not in u:
        u = "https://" + u
    parsed = urlparse(u)
    if not parsed.netloc:
        return u
    return f"{parsed.scheme or 'https'}://{parsed.netloc}"


def _region_from_oss_endpoint_host(host):
    """
    Infer OSS signing region from endpoint hostname.
    Supports path-style (oss-cn-beijing.aliyuncs.com) and virtual-hosted
    (bucket.oss-cn-beijing.aliyuncs.com). Must match actual bucket region
    or PutObject returns Invalid signing region.
    """
    host = (host or "").lower()
    if ".oss-" in host and "aliyuncs.com" in host:
        tail = host.split(".oss-", 1)[1]
        reg = tail.split(".aliyuncs.com", 1)[0]
        if reg.endswith("-internal"):
            reg = reg[: -len("-internal")]
        if reg:
            return reg
    if host.startswith("oss-") and "aliyuncs.com" in host:
        seg = host.split(".")[0]
        if seg.startswith("oss-"):
            seg = seg[4:]
        if seg.endswith("-internal"):
            seg = seg[: -len("-internal")]
        if seg:
            return seg
    return None


def _resolve_oss_region(policy, oss_region_fallback=None):
    """
    OSS SDK v2 requires region (e.g. cn-beijing).
    Prefer region parsed from endpoint host (authoritative for bucket);
    token_policy['region'] may be API region (e.g. cn-north-4) and must not
    override when host is clearly OSS virtual-hosted or path-style.
    """
    endpoint = policy.get("url") or ""
    parsed = urlparse(endpoint if "://" in endpoint else "https://" + endpoint)
    host = parsed.hostname or ""
    from_host = _region_from_oss_endpoint_host(host)
    if from_host:
        return from_host
    r = policy.get("region")
    if r:
        return str(r).strip()
    if oss_region_fallback:
        return oss_region_fallback
    raise ValueError(
        "Cannot determine OSS region from policy; set policy['region'] or pass oss_region= to AiApi."
    )


def _debug_prepared_request(prepared_request):
    """Emit opt-in sanitized diagnostics for a prepared request."""
    debug_request(
        prepared_request.method,
        prepared_request.url,
        prepared_request.headers,
        prepared_request.body,
    )


def _deep_merge_params(base, override):
    """Shallow keys from override win; nested dicts are merged recursively."""
    if not base:
        return copy.deepcopy(override) if override else {}
    if not override:
        return copy.deepcopy(base)
    out = copy.deepcopy(base)
    for k, v in override.items():
        if k in out and isinstance(out[k], dict) and isinstance(v, dict):
            out[k] = _deep_merge_params(out[k], v)
        else:
            out[k] = copy.deepcopy(v)
    return out


def _default_task_type(task_type):
    """Normalize task_type from INVOKE or caller; empty or missing → mtlab."""
    t = str(task_type or "").strip()
    return t if t else "mtlab"


def _default_connection_config():
    """Connection settings from project config.py (regions, token_policy)."""
    from .. import config as app_config

    return {
        "regions": dict(getattr(app_config, "REGIONS", {})),
        "token_policy_type": getattr(app_config, "TOKEN_POLICY_TYPE", "mtai"),
        "token_policy_types": getattr(app_config, "TOKEN_POLICY_TYPES", None),
    }


def _merge_connection_config(base, override):
    """Merge optional constructor override into connection config."""
    if not override:
        return copy.deepcopy(base)
    out = copy.deepcopy(base)
    for key, val in override.items():
        if key == "regions" and isinstance(val, dict):
            merged = copy.deepcopy(out.get("regions") or {})
            merged.update(val)
            out["regions"] = merged
        elif key == "token_policy_types" and isinstance(val, dict):
            merged = copy.deepcopy(out.get("token_policy_types") or {})
            merged.update(val)
            out["token_policy_types"] = merged
        else:
            out[key] = copy.deepcopy(val) if isinstance(val, dict) else val
    return out


class AiApi:
    """ ai api actions."""

    def __init__(self, key, secret, region="cn-north-4", oss_region=None, config=None):
        """
        :param key: your access key.
        :param secret: your access secret key.
        :param region: api access region . default "cn-north-4"
        :param oss_region: optional OSS bucket region when token_policy url cannot be parsed (e.g. custom domain)
        :param config: optional dict overriding config.py connection fields (regions,
            token_policy_type, token_policy_types). Invoke task names live in config.INVOKE.
        """
        self.Key = key
        self.Secret = secret
        self._config = _merge_connection_config(_default_connection_config(), config)
        self.region = region
        self.oss_region = oss_region
        self.aiStrategy = None
        self.storageStrategy = None
        # Resolve EndPoint lazily so fetch_config can inject it dynamically.
        self.EndPoint = self._config.get("regions", {}).get(region)

        # Initialize the persistent GID cache without a TTL.
        from .. import config as app_config
        cache_file = getattr(app_config, "GID_CACHE_FILE", "~/.cache/mtai/gid_cache.json")
        self.gid_cache = GidCache(cache_file)

    def _token_policy_type_for(self, name):
        """name is 'upload' or 'ai' — query param for /ai/token_policy?type= """
        types_map = self._config.get("token_policy_types")
        if types_map:
            return types_map.get(name) or self._config.get("token_policy_type", "mtai")
        return self._config.get("token_policy_type", "mtai")


    def getFileUrl(self,file):
        """
        Upload data to the object.

        :param data: The data to upload. This can either be bytes or a string. When this
                     argument is a string, it is interpreted as a file name, which is
                     opened in read bytes mode.
        """
        policy = self.getStorageStrategy()
        if policy is None:
            return None
        creds = policy["credentials"]
        credentials_provider = oss.credentials.StaticCredentialsProvider(
            creds["access_key"],
            creds["secret_key"],
            creds.get("session_token"),
        )
        cfg = oss.config.load_default()
        cfg.credentials_provider = credentials_provider
        cfg.region = _resolve_oss_region(policy, self.oss_region)
        cfg.endpoint = _normalize_oss_endpoint(policy["url"])
        client = oss.Client(cfg)
        try:
            if isinstance(file, str):
                result = client.put_object_from_file(
                    oss.PutObjectRequest(
                        bucket=policy["bucket"],
                        key=policy["key"],
                    ),
                    file,
                )
            else:
                result = client.put_object(
                    oss.PutObjectRequest(
                        bucket=policy["bucket"],
                        key=policy["key"],
                        body=file,
                    )
                )
            if result.status_code != 200:
                raise RuntimeError(
                    f"OSS put_object failed: status={result.status_code}, request_id={getattr(result, 'request_id', None)}"
                )
            return policy["data"]
        finally:
            if not isinstance(file, str) and getattr(file, "close", None):
                file.close()
        

    def getStorageStrategy(self):
        return self.getStrategy("upload")

    def getAiStrategy(self):
        return self.getStrategy("ai")

    def _ensure_endpoint(self):
        """Raise a clear error when EndPoint has not been configured."""
        if not self.EndPoint:
            raise RuntimeError(
                f"No endpoint is configured for region {self.region!r}. "
                "Call fetch_config() or configure regions explicitly."
            )

    def getStrategy(self, name):
        self._ensure_endpoint()
        typ = self._token_policy_type_for(name)
        now = datetime.datetime.now()
        unix_epoch = datetime.datetime(1970, 1, 1)
        unix_time = (now - unix_epoch).total_seconds()
        # Storage policies are refreshed after use; AI policies may use a valid cache.
        if name=="ai" and self.aiStrategy and self.aiStrategy["ttl"]+self.strategyLoadTime> unix_time :
            return self.aiStrategy

        from .. import config as app_config
        signer = sign.Signer(self.Key, self.Secret)
        headers = {
            sign.HeaderHost: self.EndPoint,
            "User-Agent": getattr(app_config, "USER_AGENT", "action-web-skill-v1.0.0"),
        }
        uri="https://"+ self.EndPoint + "/ai/token_policy?type="+typ
        sign_request = signer.sign(uri, "GET", headers, "")
        _debug_prepared_request(sign_request)
        session = requests.Session()
        resp = session.send(sign_request)
        if resp.status_code==200:
            policydata=json.loads(resp.content)
            if policydata==None :
                return
            policy=policydata["data"]
            cloud=policy["mtai"]["api"]["order"][0]
            cloudConf=policy["mtai"]["api"][cloud]
            self.aiStrategy=cloudConf
            storageCloud=policy["mtai"]["upload"]["order"][0]
            self.storageStrategy=policy["mtai"]["upload"][storageCloud]
            unix_epoch = datetime.datetime(1970, 1, 1)
            unix_time = (now - unix_epoch).total_seconds()
            self.strategyLoadTime=unix_time
            if name == "ai" :
                return self.aiStrategy
            return self.storageStrategy


        
    def run(
        self,
        imageUrl,
        params,
        task,
        taskType,
        context="",
        on_async_submitted=None,
        profile=None,
    ):
        """
        apply effect to the object.
        :params imageUrl  the image url array [{"url":"url"}]
        :params parmas api params object
        :params task  task name to be apply ,
        :params taskType task supporide, ["mtlab","inference","workflow"]
        :params context context string
        :param profile: optional profile attached to the first init image
        :param on_async_submitted: optional callback(task_id) before status polling
        :return: The handled result data in json.
        """
        from .. import config as app_config
        taskType = _default_task_type(taskType)
        signer = sign.Signer(self.Key, self.Secret)
        policy=self.getAiStrategy()
        host = policy["url"]
        if host.find("https")>-1 :
            host =host[8:]
        elif host.find("http")>-1 :
            host =host[7:]

        headers = {
            sign.HeaderHost: host,
            "User-Agent": getattr(app_config, "USER_AGENT", "action-api-sdk-v1.0.0"),
        }

        init_images = copy.deepcopy(imageUrl)
        if profile and init_images and isinstance(init_images[0], dict):
            init_images[0]["profile"] = copy.deepcopy(profile)

        data = {
            "params": json.dumps(params),
            "context": context,
            "task": task,
            "task_type": taskType,
            "sync_timeout":policy["sync_timeout"],
            "init_images":init_images,
        }
        uri= policy["url"] +"/"+ policy["push_path"]
        sign_request = signer.sign(uri, "POST", headers, json.dumps(data))
        _debug_prepared_request(sign_request)
        session = requests.Session()
        resp = session.send(sign_request,timeout=policy["sync_timeout"]+10)
        if resp.status_code==200 :
            taskResult= json.loads(resp.content)
            if taskResult["data"]["status"]==9:
                tid = taskResult["data"]["result"]["id"]
                if callable(on_async_submitted):
                    try:
                        on_async_submitted(str(tid).strip())
                    except Exception:
                        pass
                return self.status(tid, policy)
            else:
                return taskResult
        return json.loads(resp.content)

    def status(self,taskId,policy):
        """
        query task execute status
        :params taskId  the task id 
        :params policy query policy with retry and gaps with every retry
        :return: The handled result data in json.
        """
        host = policy["url"]
        if host.find("https")>-1 :
            host =host[8:]
        elif host.find("http")>-1 :
            host =host[7:]
        uri= policy["url"] +"/"+ policy["status_query"]["path"]+"?task_id="+taskId
        loops = policy["status_query"]["durations"]
        intervals = _ensure_min_status_poll_sleep_ms(
            _parse_status_query_intervals_ms(loops)
        )
        for d in intervals:
            result = self.queryStatus(uri,policy)
            if result["is_finished"] :
                return result["result"]
            time.sleep(int(d)/1000)
        return None

    def queryStatus(self,uri,policy):
        from .. import config as app_config
        signer =sign.Signer(self.Key,self.Secret)
        host = policy["url"]
        if host.find("https")>-1 :
            host =host[8:]
        elif host.find("http")>-1 :
            host =host[7:]
        headers = {
            sign.HeaderHost: host,
            "User-Agent": getattr(app_config, "USER_AGENT", "action-web-skill-v1.0.0"),
        }
        sign_request = signer.sign(uri, "GET", headers, "")
        _debug_prepared_request(sign_request)
        session = requests.Session()
        resp = session.send(sign_request,timeout=3)
        if resp.status_code==200 :
            taskResult= json.loads(resp.content)
            if taskResult["data"]["status"]==10 or taskResult["data"]["status"]==2 or taskResult["data"]["status"]==20 :
                return {"is_finished":True,"result":taskResult}
            else:
                return {"is_finished":False,"result":taskResult}         
        return {"is_finished":False,"result":"task query failure"}

    def invoke_task(
        self,
        name,
        url,
        params=None,
        context="",
        on_async_submitted=None,
        profile=None,
    ):
        """
        Invoke a configured task. Parameters and profiles are deep-merged with
        config.INVOKE[name], with caller-provided values taking precedence.
        """
        from .. import config as app_config

        table = getattr(app_config, "INVOKE", None) or {}
        if name not in table:
            raise KeyError(f"Unknown invoke preset {name!r}; add it to config.INVOKE")
        spec = table[name]
        if not isinstance(spec, dict) or "task" not in spec:
            raise ValueError(
                f"config.INVOKE[{name!r}] must include 'task'; optional 'params'/'profile' "
                f"(default {{}}), optional 'task_type' (default mtlab)"
            )
        cfg_params = spec.get("params")
        if cfg_params is not None and not isinstance(cfg_params, dict):
            raise TypeError(f"config.INVOKE[{name!r}]['params'] must be a dict or omit")
        merged = _deep_merge_params(cfg_params or {}, params or {})
        cfg_profile = spec.get("profile")
        if cfg_profile is not None and not isinstance(cfg_profile, dict):
            raise TypeError(f"config.INVOKE[{name!r}]['profile'] must be a dict or omit")
        if profile is not None and not isinstance(profile, dict):
            raise TypeError("profile must be a dict or omit")
        merged_profile = _deep_merge_params(cfg_profile or {}, profile or {})
        task_type = _default_task_type(spec.get("task_type"))
        profile_kwargs = {"profile": merged_profile} if merged_profile else {}
        return self.invoke(
            url,
            merged,
            spec["task"],
            context,
            task_type,
            on_async_submitted=on_async_submitted,
            **profile_kwargs,
        )

    def txt2img(self,params, context=""):
        return self.run(None,params,"txt2img","inference", context)
    

    def img2img(self,url,params, context=""):
        return self.run([{"url":url}],params,"img2img","inference", context)
    
    def inferenceConf(self):
        pass

    def invoke(
        self,
        url,
        params,
        task,
        context="",
        task_type=None,
        on_async_submitted=None,
        profile=None,
    ):
        """
        invoke ai task
        :params url  the task id
        :params params task params
        :params task ai task name ,such as v1/sod ,v1/znxc_async
        :return: The handled result data in json.
        """
        task_type = _default_task_type(task_type)
        if url is None:
            return self.run(
                None,
                params,
                task,
                task_type,
                context,
                on_async_submitted=on_async_submitted,
                profile=profile,
            )
        return self.run(
            [{"url": url}],
            params,
            task,
            task_type,
            context,
            on_async_submitted=on_async_submitted,
            profile=profile,
        )

    def get_gid(self, gid: str):
        """Return GID data from cache, falling back to the reserved API hook."""
        # Check the cache first.
        data = self.gid_cache.get(gid)
        if data is not None:
            return data

        # Cache miss: call the reserved API hook.
        # data = self.fetch_gid_from_api(gid)
        # if data is not None:
        #     self.gid_cache.set(gid, data)
        return None

    def set_gid(self, gid: str, data: dict) -> None:
        """Persist GID data in the local cache."""
        self.gid_cache.set(gid, data)

    def fetch_gid_from_api(self, gid: str):
        """Fetch GID data from the API; reserved for a future implementation."""
        # TODO: Implement the API request.
        pass
