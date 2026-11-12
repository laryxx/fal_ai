"""CLI base classes for action-api-sdk."""

from abc import ABC, abstractmethod
from typing import Callable, Dict, Optional, Protocol
import argparse


class CliInterface(Protocol):
    """CLI interface definition for external callers."""

    def catalog(self, media_type: str = "", *, refresh: bool = True) -> Dict:
        """Fetch and return the public task catalog."""
        ...

    def run_task(
        self,
        task_name: str,
        input_src: str,
        params: Optional[Dict] = None,
        on_async_submitted: Optional[Callable[[str], None]] = None,
        profile: Optional[Dict] = None,
    ) -> Dict:
        """Run a task and return result."""
        ...

    def query_task(self, task_id: str) -> Dict:
        """Query task status."""
        ...


class CliCommand(ABC):
    """Base class for CLI commands."""

    name: str = ""
    help: str = ""

    @classmethod
    @abstractmethod
    def register(cls, subparser: argparse._SubParsersAction) -> None:
        """Register this command with the subparser."""
        pass

    @abstractmethod
    def execute(self, args: argparse.Namespace) -> int:
        """Execute the command and return exit code."""
        pass
