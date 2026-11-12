"""Vmake image enhancement service (Vercel Python function).

Wraps Vmake's official Python SDK (vendored in api/_vendor, v2.0.1) so the
Next.js app can call it over HTTP. Only the Next.js server should call this:
every request must carry the shared APP_SERVER_SECRET in `x-app-secret`.

POST /api/vmake
  {"action": "enhance", "imageUrl": "https://<R2 public URL>"}
  {"action": "status",  "taskId": "t_..."}

Response (always JSON):
  {"status": "completed", "outputUrl": ..., "width": ..., "height": ..., "sizeBytes": ..., "taskId": ...}
  {"status": "processing", "taskId": ...}
  {"status": "failed", "error": "..."}

Local dev: `python api/vmake.py` serves on http://127.0.0.1:8787 and reads
.env.local; point VMAKE_SERVICE_URL at it.
"""

import hmac
import json
import os
import sys
from http.server import BaseHTTPRequestHandler, HTTPServer
from urllib.parse import quote, urlparse

_HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(_HERE, "_vendor"))

if os.environ.get("VERCEL"):
    # The SDK caches a small id under ~/.cache; only /tmp is writable on Vercel.
    os.environ["HOME"] = "/tmp"

from action_api_sdk import (  # noqa: E402
    ConfigFetchError,
    ConsumeDeniedError,
    SkillClient,
    WapiApiError,
)

# "Fast 2K - Image Quality Repair", the only image enhancement task in the
# Vmake catalog (checked 2026-11-12). Costs 10 credits per image.
ENHANCE_TASK = os.environ.get("VMAKE_ENHANCE_TASK", "SKM0004")
SUCCESS_STATUS = 10
FINISHED_STATUSES = {2, 10, 20}  # what the SDK treats as "finished"
MAX_BODY_BYTES = 64 * 1024


def _summarize(res):
    """Turn a raw Vmake task response into the small shape the app uses."""
    if not isinstance(res, dict):
        return {"status": "failed", "error": "Vmake returned an unexpected response"}

    code = res.get("code")
    if code not in (None, 0, "0"):
        return {
            "status": "failed",
            "error": f"Vmake error {code}: {res.get('message') or 'request failed'}",
        }

    data = res.get("data") or {}
    status = data.get("status")
    result = data.get("result") or {}
    task_id = str(data.get("task_id") or result.get("id") or "")
    urls = result.get("urls") or result.get("images") or []

    if status == SUCCESS_STATUS and urls:
        info = (result.get("media_info") or [{}])[0] or {}
        return {
            "status": "completed",
            "taskId": task_id,
            "outputUrl": urls[0],
            "width": info.get("width"),
            "height": info.get("height"),
            "sizeBytes": info.get("fileSize"),
        }

    if status in FINISHED_STATUSES:
        message = result.get("msg") or res.get("message") or f"status {status}"
        return {"status": "failed", "taskId": task_id, "error": f"Vmake could not enhance the image ({message})"}

    return {"status": "processing", "taskId": task_id}


def _enhance(image_url):
    client = SkillClient()
    # The SDK's own status poll waits up to an hour, which no serverless
    # function survives. If Vmake queues the job, return its id instead and
    # let the app's sync route check on it later.
    client.api.status = lambda task_id, policy: {"__queued__": str(task_id)}
    res = client.run_task(ENHANCE_TASK, image_url)
    if isinstance(res, dict) and "__queued__" in res:
        return {"status": "processing", "taskId": res["__queued__"]}
    return _summarize(res)


def _status(task_id):
    client = SkillClient()
    policy = client.api.getAiStrategy()
    if not policy:
        raise RuntimeError("Could not load the Vmake task policy")
    uri = f"{policy['url']}/{policy['status_query']['path']}?task_id={quote(task_id, safe='')}"
    checked = client.api.queryStatus(uri, policy)
    if not checked.get("is_finished"):
        return {"status": "processing", "taskId": task_id}
    return _summarize(checked.get("result"))


def _allowed_image_url(url):
    if not isinstance(url, str) or not url.startswith("https://"):
        return False
    base = (os.environ.get("R2_PUBLIC_BASE_URL") or "").rstrip("/")
    if not base:
        return True  # local dev without R2 configured
    return url.startswith(base + "/")


def handle(payload):
    """Return (http_status, json_body) for a parsed request payload."""
    if not os.environ.get("MT_AK") or not os.environ.get("MT_SK"):
        return 503, {"status": "failed", "error": "Vmake keys (MT_AK / MT_SK) are not configured"}

    action = payload.get("action")
    try:
        if action == "enhance":
            image_url = payload.get("imageUrl")
            if not _allowed_image_url(image_url):
                return 400, {"status": "failed", "error": "Image URL is not allowed"}
            return 200, _enhance(image_url)

        if action == "status":
            task_id = str(payload.get("taskId") or "").strip()
            if not task_id:
                return 400, {"status": "failed", "error": "taskId is required"}
            return 200, _status(task_id)

        return 400, {"status": "failed", "error": "Unknown action"}
    except ConsumeDeniedError as e:
        # Out of credits, daily API limit reached, or plan lacks API access.
        return 200, {"status": "failed", "error": f"Vmake refused the job (credits or daily limit): {e.msg}"}
    except ConfigFetchError as e:
        return 502, {"status": "failed", "error": f"Could not reach Vmake: {e.msg}"}
    except WapiApiError as e:
        return 502, {"status": "failed", "error": f"Vmake error: {e.msg}"}
    except Exception as e:  # network errors, upload failures, unexpected shapes
        return 502, {"status": "failed", "error": f"Vmake request failed ({type(e).__name__})"}


class handler(BaseHTTPRequestHandler):
    def _send(self, status, body):
        raw = json.dumps(body).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)

    def do_POST(self):
        expected = os.environ.get("APP_SERVER_SECRET") or ""
        provided = self.headers.get("x-app-secret") or ""
        if not expected or not hmac.compare_digest(provided.encode(), expected.encode()):
            return self._send(401, {"status": "failed", "error": "Unauthorized"})

        length = int(self.headers.get("Content-Length") or 0)
        if length <= 0 or length > MAX_BODY_BYTES:
            return self._send(400, {"status": "failed", "error": "Invalid body"})
        try:
            payload = json.loads(self.rfile.read(length))
        except ValueError:
            return self._send(400, {"status": "failed", "error": "Invalid JSON"})
        if not isinstance(payload, dict):
            return self._send(400, {"status": "failed", "error": "Invalid JSON"})

        status, body = handle(payload)
        self._send(status, body)

    def do_GET(self):
        self._send(405, {"status": "failed", "error": "Use POST"})


def _load_local_env():
    path = os.path.join(_HERE, "..", ".env.local")
    if not os.path.exists(path):
        return
    with open(path, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, value = line.split("=", 1)
            key, value = key.strip(), value.strip().strip("\"'")
            if key and value and key not in os.environ:
                os.environ[key] = value


if __name__ == "__main__":
    _load_local_env()
    port = int(os.environ.get("VMAKE_DEV_PORT", "8787"))
    print(f"Vmake dev service on http://127.0.0.1:{port} (task {ENHANCE_TASK})")
    HTTPServer(("127.0.0.1", port), handler).serve_forever()
