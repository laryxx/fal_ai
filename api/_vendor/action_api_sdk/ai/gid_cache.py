import json
import os
import datetime


class GidCache:
    """Manage the persistent local GID cache."""

    def __init__(self, cache_file: str, ttl: int = None):
        """
        :param cache_file: cache path, for example ~/.cache/mtai/gid_cache.json
        :param ttl: cache lifetime in seconds; None stores entries indefinitely
        """
        self.cache_file = os.path.expanduser(cache_file)
        self.ttl = ttl
        self._cache = {}
        self._load()

    def get(self, gid: str):
        """Return cached GID data, or None when missing or expired."""
        if gid not in self._cache:
            return None

        entry = self._cache[gid]
        created_at = entry.get("created_at", 0)
        now = datetime.datetime.now(datetime.timezone.utc).timestamp()

        # A None TTL keeps entries indefinitely.
        if self.ttl is not None and now - created_at > self.ttl:
            # Remove expired entries.
            self.delete(gid)
            return None

        return entry.get("data")

    def set(self, gid: str, data: dict) -> None:
        """Set GID cache data and persist it to disk."""
        now = datetime.datetime.now(datetime.timezone.utc).timestamp()
        self._cache[gid] = {
            "data": data,
            "created_at": now
        }
        self._save()

    def delete(self, gid: str) -> None:
        """Delete one GID cache entry."""
        if gid in self._cache:
            del self._cache[gid]
            self._save()

    def clear(self) -> None:
        """Clear all GID cache entries."""
        self._cache = {}
        self._save()

    def _load(self) -> None:
        """Load cache data from disk."""
        if not os.path.exists(self.cache_file):
            return

        try:
            with open(self.cache_file, "r", encoding="utf-8") as f:
                self._cache = json.load(f)
        except (json.JSONDecodeError, IOError):
            # Fall back to an empty cache on corruption or read failure.
            self._cache = {}

    def _save(self) -> None:
        """Persist cache data to disk."""
        try:
            cache_dir = os.path.dirname(self.cache_file)
            if cache_dir:
                os.makedirs(cache_dir, exist_ok=True)

            with open(self.cache_file, "w", encoding="utf-8") as f:
                json.dump(self._cache, f, ensure_ascii=False, indent=2)
        except IOError:
            # Keep the in-memory cache when persistence fails.
            pass

    def is_valid(self, gid: str) -> bool:
        """Return whether a GID cache entry exists and has not expired."""
        if gid not in self._cache:
            return False

        # A None TTL never expires.
        if self.ttl is None:
            return True

        entry = self._cache[gid]
        created_at = entry.get("created_at", 0)
        now = datetime.datetime.now(datetime.timezone.utc).timestamp()

        return now - created_at <= self.ttl
