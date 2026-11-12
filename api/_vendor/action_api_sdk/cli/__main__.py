"""python -m action_api_sdk.cli"""

import sys

# Prefer the package-level cli.py entry when available; fall back to importing
# the sibling module by path-safe name ``action_api_sdk.cli`` conflicts with this
# package, so load the file module explicitly.
from importlib.util import module_from_spec, spec_from_file_location
from pathlib import Path

_cli_file = Path(__file__).resolve().parent.parent / "cli.py"
_spec = spec_from_file_location("action_api_sdk._cli_entry", _cli_file)
_mod = module_from_spec(_spec)
assert _spec.loader is not None
_spec.loader.exec_module(_mod)

if __name__ == "__main__":
    sys.exit(_mod.main())
