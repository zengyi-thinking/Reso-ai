from __future__ import annotations

from dataclasses import dataclass
from uuid import UUID

from reso_agent.context.builder import BuiltContext
from reso_agent.contracts import (
    AgentMode,
    AgentPublicEvent,
    AgentPublicReflectionEvent,
    AgentStatusEvent,
    AgentStatusPhase,
    ConversationCadence,
    MemoryType,
)
from reso_agent.runtime.mode_router import ModeSelection, TurnPerception

PUBLIC_RECALL_MIN_SCORE = 0.45

_RELATIONSHIP_MARKERS = ("关系", "朋友", "她", "他", "喜欢", "冷淡", "回复", "聊天")
_LOW_STAKES_MARKERS = ("吃什么", "喝什么", "天气", "晚安", "早安", "在吗", "哈哈")
_MEMORY_REQUEST_MARKERS = ("记得", "之前说过", "以前提过")

# Runtime-owned status copy library. The model never authors status text; the
# variants keep the rhythm alive without turning deliberation into a performance.
_STATUS_LIBRARY: dict[AgentStatusPhase, tuple[str, ...]] = {
    AgentStatusPhase.UNDERSTANDING: (
        "我想先把这件事放慢一点看看…",
        "正在想想这件事…",
        "我先听懂你在说什么…",
    ),
    AgentStatusPhase.RECALLING: (
        "想起了一件和你有关的事…",
        "等等，我好像记得这个…",
        "让我翻一下之前的记忆…",
    ),
    AgentStatusPhase.NOTICING: (
        "我好像注意到了一个小变化…",
        "有个细节让我停了一下…",
        "这里有个东西轻轻响了一下…",
    ),
    AgentStatusPhase.COMPOSING: ("我在想怎么跟你说比较好…",),
    AgentStatusPhase.RECONSIDERING: (
        "等等，我再换一个角度看看。",
        "……我再想一下，刚才那个说法可能太快了。",
        "慢一点，我想再核对一次。",
    ),
}


def _status_text(phase: AgentStatusPhase, message: str) -> str:
    variants = _STATUS_LIBRARY[phase]
    index = sum(ord(character) for character in message) % len(variants)
    return variants[index]


def _recall_text(context: BuiltContext, message: str) -> str:
    """Recall status text grounded in what retrieval actually found."""
    recalled = [
        item for item in context.retrieved_memories if item.score.final >= PUBLIC_RECALL_MIN_SCORE
    ]
    if not recalled:
        return _status_text(AgentStatusPhase.RECALLING, message)
    top = recalled[0]
    date_text = f"{top.memory.occurred_at.month}月{top.memory.occurred_at.day}日"
    if top.memory.type is MemoryType.CORRECTION:
        return f"翻到你 {date_text} 纠正过我的一次…"
    if len(recalled) >= 2:
        return f"找到 {len(recalled)} 条和你有关的记忆…"
    return f"翻到你 {date_text} 说的事…"


@dataclass(frozen=True)
class CadenceDecision:
    cadence: ConversationCadence
    reason: str
    evidence_refs: tuple[str, ...]
    status_events: tuple[AgentStatusEvent, ...]


class ConversationCadencePolicy:
    """Selects a bounded public rhythm from inspectable runtime signals."""

    def decide(
        self,
        *,
        message: str,
        perception: TurnPerception,
        selection: ModeSelection,
        context: BuiltContext,
        recent_cadences: tuple[ConversationCadence, ...] = (),
        recent_public_memory_ids: tuple[UUID, ...] = (),
    ) -> CadenceDecision:
        if perception.no_analysis or perception.simple_fatigue or perception.is_correction:
            return CadenceDecision(
                ConversationCadence.DIRECT,
                "anti-overanalysis boundary",
                (),
                (),
            )

        lowered = message.lower()
        top_memory = next(
            (
                item
                for item in context.retrieved_memories
                if item.score.final >= PUBLIC_RECALL_MIN_SCORE
            ),
            None,
        )
        memory_requested = any(marker in lowered for marker in _MEMORY_REQUEST_MARKERS)
        memory_ref = "memory:0" if top_memory is not None else None
        can_surface_memory = bool(
            memory_ref
            and top_memory is not None
            and (memory_requested or top_memory.memory.id not in recent_public_memory_ids[-4:])
        )
        relation_topic = any(marker in lowered for marker in _RELATIONSHIP_MARKERS)
        low_stakes = len(message) <= 20 and any(marker in lowered for marker in _LOW_STAKES_MARKERS)

        if low_stakes or (
            selection.mode is AgentMode.COMPANION and not relation_topic and not can_surface_memory
        ):
            return CadenceDecision(
                ConversationCadence.DIRECT,
                "ordinary low-stakes conversation",
                (),
                (),
            )

        evidence_refs: tuple[str, ...] = (memory_ref,) if can_surface_memory and memory_ref else ()
        serious_concern = relation_topic and len(message) >= 10
        if relation_topic and (selection.mode is AgentMode.MIRROR or serious_concern):
            weak_memory = top_memory is None or top_memory.score.final < 0.62
            cooldown_clear = ConversationCadence.RECONSIDERED not in recent_cadences[-6:]
            if weak_memory and cooldown_clear and len(context.recent_messages) >= 2:
                return CadenceDecision(
                    ConversationCadence.RECONSIDERED,
                    "relationship reflection has multiple plausible readings",
                    evidence_refs or ("message:current",),
                    (
                        AgentStatusEvent(
                            phase=AgentStatusPhase.NOTICING,
                            text=_status_text(AgentStatusPhase.NOTICING, message),
                        ),
                        AgentStatusEvent(
                            phase=AgentStatusPhase.RECONSIDERING,
                            text=_status_text(AgentStatusPhase.RECONSIDERING, message),
                        ),
                    ),
                )

        if can_surface_memory or selection.mode is AgentMode.MIRROR:
            phase = AgentStatusPhase.RECALLING if can_surface_memory else AgentStatusPhase.NOTICING
            text = (
                _recall_text(context, message)
                if can_surface_memory
                else _status_text(AgentStatusPhase.NOTICING, message)
            )
            return CadenceDecision(
                ConversationCadence.REFLECTIVE,
                "relevant memory or invited reflection",
                evidence_refs or ("message:current",),
                (AgentStatusEvent(phase=phase, text=text),),
            )

        return CadenceDecision(
            ConversationCadence.CONSIDERED,
            "relationship or expression question benefits from a short pause",
            (),
            (
                AgentStatusEvent(
                    phase=AgentStatusPhase.UNDERSTANDING,
                    text=_status_text(AgentStatusPhase.UNDERSTANDING, message),
                ),
            ),
        )

    def safe_reflection(
        self, *, decision: CadenceDecision, context: BuiltContext
    ) -> AgentPublicReflectionEvent | None:
        if decision.cadence not in {
            ConversationCadence.REFLECTIVE,
            ConversationCadence.RECONSIDERED,
        }:
            return None
        if "memory:0" in decision.evidence_refs and context.retrieved_memories:
            memory = context.retrieved_memories[0].memory
            prefix = (
                "你之前纠正过我：" if memory.type is MemoryType.CORRECTION else "你之前提到过："
            )
            return AgentPublicReflectionEvent(
                text=f"{prefix}{memory.summary}",
                evidence_refs=["memory:0"],
            )
        return AgentPublicReflectionEvent(
            text="我有一个还不太确定的猜测：这件事可能不只是一种解释。",
            evidence_refs=["message:current"],
        )


def event_evidence_refs(events: list[AgentPublicEvent]) -> tuple[str, ...]:
    return tuple(
        reference
        for event in events
        if isinstance(event, AgentPublicReflectionEvent)
        for reference in event.evidence_refs
    )
