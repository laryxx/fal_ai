"""Stable console-script entry that loads action_api_sdk/cli.py."""

from importlib.util import module_from_spec, spec_from_file_location
from pathlib import Path

_cli_file = Path(__file__).resolve().parent.parent / "cli.py"
_spec = spec_from_file_location("action_api_sdk._cli_entry", _cli_file)
_mod = module_from_spec(_spec)
assert _spec.loader is not None
_spec.loader.exec_module(_mod)

main = _mod.main
