WAPI_ENDPOINT = "wapi-skill.vmake.ai"

# GID cache configuration (persistent, without a TTL).
GID_CACHE_FILE = "~/.cache/mtai/gid_cache.json"

VERSION = "v2.0.1"
USER_AGENT_NAME = "action-api-sdk"
USER_AGENT = f"{USER_AGENT_NAME}-{VERSION}"

# Config schemas this SDK can parse, in preference order (V2 first).
SUPPORTED_SCHEMAS = ("v2", "v1")

# Region configuration, updated from the remote skill config.
REGIONS = {
    "cn-north-4": ""
}

# Algorithm presets, updated from the remote skill config.
INVOKE = {}
