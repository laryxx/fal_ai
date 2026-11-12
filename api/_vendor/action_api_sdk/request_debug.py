"""Safe, opt-in request diagnostics shared by SDK transports."""

import json
import os
from urllib.parse import urlsplit, urlunsplit


_VISIBLE_HEADERS = {
    "content-length",
    "content-type",
    "host",
    "user-agent",
    "x-sdk-date",
}
_VISIBLE_BODY_FIELDS = {"sync_timeout", "task", "task_type"}


def _debug_enabled():
    """Return whether sanitized request diagnostics are enabled."""
    return os.environ.get("WAPI_DEBUG", "").lower() in ("1", "true", "yes")


def _redact_url(url):
    """Keep only URL routing information, excluding credentials and query values."""
    try:
        parsed = urlsplit(str(url or ""))
        hostname = parsed.hostname or ""
        if parsed.port:
            hostname = f"{hostname}:{parsed.port}"
        return urlunsplit((parsed.scheme, hostname, parsed.path, "", ""))
    except ValueError:
        return "<redacted>"


def _redact_headers(headers):
    """Expose only headers useful for routing and content diagnostics."""
    return {
        str(key): value if str(key).lower() in _VISIBLE_HEADERS else "<redacted>"
        for key, value in (headers or {}).items()
    }


def _redact_body(body):
    """Expose only non-sensitive execution fields from a JSON request body."""
    if not body:
        return None
    if isinstance(body, bytes):
        body = body.decode("utf-8", errors="replace")
    try:
        payload = json.loads(body)
    except (TypeError, ValueError):
        return "<redacted>"
    if not isinstance(payload, dict):
        return "<redacted>"
    return {
        str(key): value if key in _VISIBLE_BODY_FIELDS else "<redacted>"
        for key, value in payload.items()
    }


def debug_request(method, url, headers=None, body=None):
    """Print sanitized request metadata only when ``WAPI_DEBUG`` is enabled."""
    if not _debug_enabled():
        return
    record = {
        "method": str(method or ""),
        "url": _redact_url(url),
        "headers": _redact_headers(headers),
    }
    safe_body = _redact_body(body)
    if safe_body is not None:
        record["body"] = safe_body
    print("[DEBUG] Request " + json.dumps(record, ensure_ascii=False, sort_keys=True))
