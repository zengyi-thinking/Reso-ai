from __future__ import annotations

from dataclasses import dataclass
from enum import StrEnum

from reso_agent.contracts import MemoryRecord, RecentMessage, RelationshipContext


class PresenceContinuity(StrEnum):
    FIRST_MEETING = "first_meeting"
    ONGOING = "ongoing"
    RETURNING = "returning"


@dataclass(frozen=True)
class PresenceState:
    """Companionship state derived only from authorized inputs; never fabricated."""

    together_turns: int
    shared_memories: int
    continuity: PresenceContinuity
    summary: str


class PresenceBuilder:
    """Formalizes the cross-turn presence signal (turns, shared memory, continuity)."""

    def build(
        self,
        *,
        relationship: RelationshipContext | None,
        memories: list[MemoryRecord],
        recent_messages: list[RecentMessage],
    ) -> PresenceState:
        together_turns = relationship.interaction_count if relationship else 0
        shared_memories = len(memories)
        if together_turns == 0 and not recent_messages:
            continuity = PresenceContinuity.FIRST_MEETING
            summary = "这是你们第一次正式对话；还没有共享的记忆。"
        elif not recent_messages:
            continuity = PresenceContinuity.RETURNING
            summary = (
                f"用户带着 {together_turns} 轮同行经历和 {shared_memories} 段共享记忆回来了；"
                "这是一个新的会话窗口。"
            )
        else:
            continuity = PresenceContinuity.ONGOING
            summary = f"你们正在持续同行：累计 {together_turns} 轮，共享 {shared_memories} 段记忆。"
        return PresenceState(
            together_turns=together_turns,
            shared_memories=shared_memories,
            continuity=continuity,
            summary=summary,
        )
