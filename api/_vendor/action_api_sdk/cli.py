#!/usr/bin/env python3
"""action-api-sdk CLI — catalog / run-task / query-task / list-tasks."""

from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

# Allow `python action_api_sdk/cli.py` from a checkout without install.
PACKAGE_ROOT = Path(__file__).resolve().parent.parent
if str(PACKAGE_ROOT) not in sys.path:
    sys.path.insert(0, str(PACKAGE_ROOT))

from action_api_sdk import SkillClient
from action_api_sdk import config as app_config
from action_api_sdk.client import (
    ConfigFetchError,
    ConsumeDeniedError,
    public_catalog,
)


def _print(data: dict) -> None:
    print(json.dumps(data, indent=2, ensure_ascii=False))


def _task_succeeded(result: dict) -> bool:
    if not isinstance(result, dict):
        return False
    if result.get("skill_status") == "failed" or result.get("error"):
        return False
    if result.get("skill_status") == "completed":
        return True
    if result.get("output_urls"):
        return True
    data = result.get("data")
    if isinstance(data, dict) and data.get("status") in (10, 2, 20):
        return True
    return False


def _attach_notices(result: dict, client: SkillClient) -> dict:
    if not isinstance(result, dict):
        return result
    notices = client.get_notices()
    if notices and "notices" not in result:
        out = dict(result)
        out["notices"] = notices
        return out
    return result


def _handle(func):
    try:
        return func()
    except ConsumeDeniedError as e:
        out = {"error": "quota_error", "code": e.code, "message": e.msg}
        if e.notices:
            out["notices"] = e.notices
        _print(out)
        return 1
    except ConfigFetchError as e:
        out = {
            "error": "config_unavailable",
            "skill_status": "failed",
            "code": e.code,
            "message": e.msg,
        }
        if e.notices:
            out["notices"] = e.notices
        _print(out)
        return 1
    except Exception as e:
        _print({"error": str(e)})
        return 1


def catalog(
    ak: str,
    sk: str,
    media_type: str = "",
    *,
    agent_name=None,
    agent_version=None,
    agent_model=None,
) -> int:
    """Fetch and print the remote task catalog without upload or consume."""

    def _do():
        client = SkillClient(
            ak=ak,
            sk=sk,
            auto_fetch_config=False,
            agent_name=agent_name,
            agent_version=agent_version,
            agent_model=agent_model,
        )
        raw = client.get_task_catalog(refresh=True)
        out = public_catalog(raw, media_type)
        out = _attach_notices(out, client)
        if raw.get("mode") not in ("v2", "legacy") or not out["tasks"]:
            out.update(
                {
                    "error": "config_catalog_empty",
                    "skill_status": "failed",
                }
            )
            _print(out)
            return 1
        _print(out)
        return 0

    return _handle(_do)


def run_task(
    ak: str,
    sk: str,
    task: str,
    source: str,
    params: str = None,
    profile: str = None,
    *,
    agent_name=None,
    agent_version=None,
    agent_model=None,
) -> int:
    def _do():
        client = SkillClient(
            ak=ak,
            sk=sk,
            agent_name=agent_name,
            agent_version=agent_version,
            agent_model=agent_model,
        )
        p = json.loads(params) if params else {}
        input_profile = json.loads(profile) if profile else None
        if input_profile is not None and not isinstance(input_profile, dict):
            raise ValueError("--profile must be a JSON object")
        result = client.run_task(
            task_name=task,
            image_path=source or "",
            params=p,
            profile=input_profile,
        )
        _print(result)
        return 0 if _task_succeeded(result) else 1

    return _handle(_do)


def query_task(
    ak: str,
    sk: str,
    task_id: str,
    *,
    agent_name=None,
    agent_version=None,
    agent_model=None,
) -> int:
    def _do():
        client = SkillClient(
            ak=ak,
            sk=sk,
            agent_name=agent_name,
            agent_version=agent_version,
            agent_model=agent_model,
        )
        result = client.poll_task_status(task_id)
        _print(result)
        return 0 if _task_succeeded(result) else 1

    return _handle(_do)


def list_tasks(
    ak: str,
    sk: str,
    *,
    agent_name=None,
    agent_version=None,
    agent_model=None,
) -> int:
    """List task presets currently loaded into INVOKE (after config fetch)."""

    def _do():
        SkillClient(
            ak=ak,
            sk=sk,
            agent_name=agent_name,
            agent_version=agent_version,
            agent_model=agent_model,
        )
        tasks = [{"name": n, **c} for n, c in app_config.INVOKE.items()]
        _print({"tasks": tasks, "count": len(tasks)})
        return 0

    return _handle(_do)


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description="action-api-sdk CLI")
    parser.add_argument("--ak", default=os.environ.get("MT_AK"), help="Access Key")
    parser.add_argument("--sk", default=os.environ.get("MT_SK"), help="Secret Key")
    sub = parser.add_subparsers(dest="cmd", required=True)

    p = sub.add_parser(
        "catalog",
        help="Fetch remote task catalog only (no upload, consume, or algorithm submit)",
    )
    p.add_argument(
        "--media-type",
        choices=("image", "video"),
        default="",
        help="Optional remote catalog filter",
    )

    p = sub.add_parser("run-task", help="Run AI task (upload+consume+submit+poll)")
    p.add_argument(
        "--task",
        required=True,
        help="Exact V2 material_id (preferred), unique V2 name, or returned legacy alias",
    )
    p.add_argument("--input", default="", help="Input file or URL")
    p.add_argument("--params", help="Params (JSON)")
    p.add_argument(
        "--profile",
        help="Input profile JSON object overriding the server-provided profile",
    )

    p = sub.add_parser("query-task", help="Query task status")
    p.add_argument("--task-id", required=True, help="Task ID")

    sub.add_parser("list-tasks", help="List available tasks from INVOKE")

    for command in sub.choices.values():
        command.add_argument(
            "--agent-name",
            default=None,
            help="Caller name; defaults to SKILL_AGENT_NAME, then cli",
        )
        command.add_argument(
            "--agent-version",
            default=None,
            help="Caller version; defaults to SKILL_AGENT_VERSION",
        )
        command.add_argument(
            "--agent-model",
            default=None,
            help="Caller model; defaults to SKILL_AGENT_MODEL",
        )

    args = parser.parse_args(argv)

    if not args.ak or not args.sk:
        parser.error("--ak and --sk required (or MT_AK/MT_SK env vars)")

    agent_name = args.agent_name
    if agent_name is None and not os.environ.get("SKILL_AGENT_NAME"):
        agent_name = "cli"
    agent_kwargs = {
        "agent_name": agent_name,
        "agent_version": args.agent_version,
        "agent_model": args.agent_model,
    }

    if args.cmd == "catalog":
        return catalog(args.ak, args.sk, args.media_type, **agent_kwargs)
    if args.cmd == "run-task":
        return run_task(
            args.ak,
            args.sk,
            args.task,
            args.input,
            args.params,
            args.profile,
            **agent_kwargs,
        )
    if args.cmd == "query-task":
        return query_task(args.ak, args.sk, args.task_id, **agent_kwargs)
    if args.cmd == "list-tasks":
        return list_tasks(args.ak, args.sk, **agent_kwargs)
    return 0


if __name__ == "__main__":
    sys.exit(main())
