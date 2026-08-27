"""Allowlisted internal tools.

Tools execute only after policy approval and only read data that is already
present in the authorized request context. They never reach the network and
never touch a Product-owned store - the registry exists so the runtime can be
honest about *which* extra in-context lookups shaped an answer (trace allows
exactly `tool_names`, nothing more).
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Protocol


@dataclass(frozen=True)
class ToolSpec:
    name: str
    description: str


@dataclass(frozen=True)
class ToolResult:
    """Outcome of one internal tool execution; `data` stays in-request only."""

    name: str
    ok: bool
    detail: str = ""
    data: tuple[Any, ...] = ()


class RuntimeTool(Protocol):
    spec: ToolSpec

    def run(self, *args: Any, **kwargs: Any) -> ToolResult: ...


_MAX_TOOLS = 8


class ToolRegistry:
    """Fail-closed allowlist: nothing runs unless explicitly registered."""

    def __init__(self) -> None:
        self._tools: dict[str, RuntimeTool] = {}

    def register(self, tool: RuntimeTool) -> RuntimeTool:
        name = tool.spec.name
        if name in self._tools:
            raise ValueError(f"tool already registered: {name}")
        if len(self._tools) >= _MAX_TOOLS:
            raise ValueError("tool allowlist is full")
        self._tools[name] = tool
        return tool

    def get(self, name: str) -> RuntimeTool | None:
        return self._tools.get(name)

    @property
    def specs(self) -> tuple[ToolSpec, ...]:
        return tuple(tool.spec for tool in self._tools.values())
