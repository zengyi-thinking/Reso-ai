"""Internal deep-recall tool: a second-pass lexical sweep over the memories
already authorized for this request.

Trigger contract: fires only when the user's message explicitly references past
conversation ("上次/之前/还记得..."). It reads nothing but the in-payload memory
list, so it cannot widen access - it just gives weak lexical matches a second
chance under rephrased queries.
"""

from __future__ import annotations

import re

from reso_agent.contracts import RetrievedMemory
from reso_agent.memory.retriever import MemoryRetriever
from reso_agent.tools.registry import ToolResult, ToolSpec

_TOOL_NAME = "memory_deep_recall"

_RECALL_CUES = ("上次", "之前", "还记得", "我们说过", "上周", "早些时候", "那天", "此前")
_QUOTED_SPAN = re.compile(r"[“「']([^”」']{2,24})[”」']")
# Aligned with the public-output evidence threshold so every extra memory the
# tool surfaces is also citable as allowedEvidence.
_MIN_EXTRA_SCORE = 0.45
_MAX_EXTRAS = 2


class MemoryDeepRecallTool:
    spec = ToolSpec(
        name=_TOOL_NAME,
        description=(
            "Second-pass recall over this turn's authorized memories when the "
            "user references past conversation explicitly."
        ),
    )

    def __init__(self, retriever: MemoryRetriever | None = None) -> None:
        self._retriever = retriever or MemoryRetriever()

    def triggered(self, message: str) -> bool:
        return any(cue in message for cue in _RECALL_CUES)

    def variants(self, message: str) -> tuple[str, ...]:
        candidates: list[str] = []
        stripped = message
        for cue in _RECALL_CUES:
            stripped = stripped.replace(cue, "")
        stripped = stripped.strip(" ，。？！,.?!")
        if stripped:
            candidates.append(stripped)
        candidates.extend(span.strip() for span in _QUOTED_SPAN.findall(message))
        unique: list[str] = []
        for candidate in candidates:
            if candidate and candidate not in unique:
                unique.append(candidate)
        return tuple(unique)

    def run(
        self,
        *,
        message: str,
        memories: list,
        exclude_ids: frozenset | set[str] | None = None,
        now=None,
    ) -> ToolResult:
        if not self.triggered(message):
            return ToolResult(name=_TOOL_NAME, ok=True, detail="not-triggered")
        excluded = exclude_ids or set()
        added: list[RetrievedMemory] = []
        seen_base_ids = set(excluded)
        for variant in self.variants(message)[:3]:
            for item in self._retriever.retrieve(
                query=variant, memories=memories, top_k=3, now=now
            ):
                memory_id = str(item.memory.id)
                if memory_id in seen_base_ids or item.memory.id in excluded:
                    continue
                if item.score.final < _MIN_EXTRA_SCORE:
                    continue
                seen_base_ids.add(memory_id)
                added.append(item)
                if len(added) >= _MAX_EXTRAS:
                    return ToolResult(
                        name=_TOOL_NAME,
                        ok=True,
                        detail=f"recalled={len(added)}",
                        data=tuple(added),
                    )
        detail = f"recalled={len(added)}" if added else "no-extra-recall"
        return ToolResult(name=_TOOL_NAME, ok=True, detail=detail, data=tuple(added))
