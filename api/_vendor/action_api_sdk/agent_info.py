"""Optional caller metadata for WAPI requests."""

import locale
import os
import platform
import unicodedata
from datetime import datetime


_AGENT_HEADER_NAMES = {
    "name": "X-Agent-Name",
    "version": "X-Agent-Version",
    "model": "X-Agent-Model",
    "os": "X-Agent-OS",
    "os_version": "X-Agent-OS-Version",
    "arch": "X-Agent-Arch",
    "language": "X-Agent-Language",
    "timezone": "X-Agent-Timezone",
    "skill_version": "X-Agent-Skill-Version",
    "runtime_version": "X-Agent-Runtime-Version",
}


def _normalize_header_value(value, limit, *, lowercase=False):
    """Normalize optional telemetry without allowing it to block a request."""
    if value is None:
        return ""
    value = str(value)
    if any(unicodedata.category(char) == "Cc" for char in value):
        return ""
    value = value.strip()
    if lowercase:
        value = value.lower()
    try:
        value.encode("latin-1")
    except UnicodeError:
        return ""
    if len(value.encode("utf-8")) > limit:
        return ""
    return value


def resolve_agent_info(name=None, version=None, model=None):
    """Resolve explicit Agent metadata, falling back to ``SKILL_AGENT_*``."""
    result = {}
    for field, value, limit in (
        ("name", name, 64),
        ("version", version, 128),
        ("model", model, 256),
    ):
        if value is None:
            value = os.environ.get("SKILL_AGENT_" + field.upper(), "")
        result[field] = _normalize_header_value(
            value,
            limit,
            lowercase=field == "name",
        )
    return result


def _best_effort(callback):
    """Keep optional host inspection failures from affecting the request."""
    try:
        return callback()
    except Exception:
        return ""


def resolve_agent_os():
    """Return the request host OS using action-common's standard enum."""
    system = _normalize_header_value(
        _best_effort(platform.system), 32, lowercase=True
    )
    return {
        "darwin": "mac",
        "windows": "windows",
        "linux": "linux",
    }.get(system, "")


def resolve_agent_os_version(agent_os):
    """Return a useful OS version without guessing unsupported platforms."""
    if agent_os == "mac":
        value = _best_effort(lambda: platform.mac_ver()[0]) or _best_effort(
            platform.release
        )
    elif agent_os == "windows":
        value = _best_effort(platform.version) or _best_effort(platform.release)
    elif agent_os == "linux":
        value = _best_effort(platform.release)
    else:
        value = ""
    return _normalize_header_value(value, 128)


def resolve_agent_arch():
    """Normalize common Python machine names to the Agent architecture enum."""
    machine = _normalize_header_value(
        _best_effort(platform.machine), 32, lowercase=True
    )
    return {
        "arm64": "arm64",
        "aarch64": "arm64",
        "x86_64": "x86_64",
        "amd64": "x86_64",
        "x86": "x86",
        "i386": "x86",
        "i686": "x86",
    }.get(machine, "")


def resolve_agent_language():
    """Return the process locale in BCP-47-like form when available."""
    value = _best_effort(lambda: locale.getlocale()[0] or "")
    return _normalize_header_value(value, 32).replace("_", "-")


def resolve_agent_timezone():
    """Return the current UTC offset as GMT+08:00 style telemetry."""

    def format_offset():
        offset = datetime.now().astimezone().utcoffset()
        if offset is None:
            return ""
        seconds = int(offset.total_seconds())
        sign = "+" if seconds >= 0 else "-"
        minutes = abs(seconds) // 60
        return "GMT{}{:02d}:{:02d}".format(
            sign, minutes // 60, minutes % 60
        )

    return _normalize_header_value(_best_effort(format_offset), 32)


def resolve_agent_environment(skill_version=""):
    """Collect best-effort request-host metadata for WAPI telemetry."""
    agent_os = resolve_agent_os()
    return {
        "os": agent_os,
        "os_version": resolve_agent_os_version(agent_os),
        "arch": resolve_agent_arch(),
        "language": resolve_agent_language(),
        "timezone": resolve_agent_timezone(),
        "skill_version": _normalize_header_value(skill_version, 128),
        "runtime_version": _normalize_header_value(
            _best_effort(platform.python_version), 64
        ),
    }


def agent_headers(info, skill_version=""):
    """Return caller and request-host metadata as normalized WAPI headers."""
    metadata = dict(info or {})
    metadata.update(resolve_agent_environment(skill_version))
    return {
        _AGENT_HEADER_NAMES[field]: value
        for field, value in metadata.items()
        if field in _AGENT_HEADER_NAMES and value
    }
