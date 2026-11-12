"""Task runner for action-api-sdk CLI."""

from typing import Callable, Dict, Optional

from action_api_sdk.client import SkillClient, public_catalog


class TaskRunner:
    """Unified task runner for CLI operations."""

    def __init__(
        self,
        client: Optional[SkillClient] = None,
        ak: Optional[str] = None,
        sk: Optional[str] = None,
        region: str = "cn-north-4",
        *,
        auto_fetch_config: bool = True,
        agent_name: Optional[str] = None,
        agent_version: Optional[str] = None,
        agent_model: Optional[str] = None,
    ):
        if client:
            self.client = client
        else:
            self.client = SkillClient(
                ak=ak,
                sk=sk,
                region=region,
                auto_fetch_config=auto_fetch_config,
                agent_name=agent_name,
                agent_version=agent_version,
                agent_model=agent_model,
            )

    def catalog(self, media_type: str = "", *, refresh: bool = True) -> Dict:
        """Fetch remote task catalog (V2 discovery; no upload/consume)."""
        catalog = self.client.get_task_catalog(refresh=refresh)
        return public_catalog(catalog, media_type)

    def run(
        self,
        task_name: str,
        input_src: str,
        params: Optional[Dict] = None,
        on_async_submitted: Optional[Callable[[str], None]] = None,
        profile: Optional[Dict] = None,
    ) -> Dict:
        return self.client.run_task(
            task_name=task_name,
            image_path=input_src,
            params=params,
            on_async_submitted=on_async_submitted,
            profile=profile,
        )

    def resume(self, task_id: str) -> Dict:
        return self.client.poll_task_status(task_id)
