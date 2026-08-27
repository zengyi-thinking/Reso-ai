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
from reso_agent.runtime.language import quote_terms
from reso_agent.runtime.mode_router import ModeSelection, TurnPerception

PUBLIC_RECALL_MIN_SCORE = 0.45

_RELATIONSHIP_MARKERS = ("关系", "朋友", "她", "他", "喜欢", "冷淡", "回复", "聊天")
_LOW_STAKES_MARKERS = ("吃什么", "喝什么", "天气", "晚安", "早安", "在吗", "哈哈")
_MEMORY_REQUEST_MARKERS = ("记得", "之前说过", "以前提过")

# Last-resort variants for messages with no extractable content anchor; every
# other status line is derived from the actual message or retrieved memory.
_STATUS_LIBRARY: dict[AgentStatusPhase, tuple[str, ...]] = {
    AgentStatusPhase.UNDERSTANDING: (
        "想把这句话听完整…",
        "在听，让我贴着它一会儿…",
    ),
    AgentStatusPhase.RECALLING: ("翻了一下记忆…",),
    AgentStatusPhase.NOTICING: ("有个地方让我停了一下…",),
    AgentStatusPhase.COMPOSING: ("在心里组织怎么回…",),
    AgentStatusPhase.RECONSIDERING: ("刚才下结论太快，换个角度再核一遍…",),
}


def _status_text(phase: AgentStatusPhase, message: str) -> str:
    anchor = quote_terms(message, limit=1)
    if anchor:
        if phase is AgentStatusPhase.UNDERSTANDING:
            return f"先接住你说的{anchor}…"
        if phase is AgentStatusPhase.NOTICING:
            return f"{anchor}这个细节让我停了一下…"
        if phase is AgentStatusPhase.RECONSIDERING:
            return f"草稿里对{anchor}下结论太快了，换个角度再核…"
        if phase is AgentStatusPhase.COMPOSING:
            return f"在想怎么回你说的{anchor}…"
    variants = _STATUS_LIBRARY[phase]
    index = sum(ord(character) for character in message) % len(variants)
    return variants[index]


def composing_status(message: str) -> AgentStatusEvent:
    """Live-only composing signal for cadences that persist no status events."""
    return AgentStatusEvent(
        phase=AgentStatusPhase.COMPOSING, text=_status_text(AgentStatusPhase.COMPOSING, message)
    )


def _memory_anchor(memory_summary: str) -> str:
    return quote_terms(memory_summary, limit=1)


def _recall_text(context: BuiltContext, message: str) -> str:
    """Recall status text grounded in what retrieval actually found."""
    recalled = [
        item for item in context.retrieved_memories if item.score.final >= PUBLIC_RECALL_MIN_SCORE
    ]
    if not recalled:
        anchor = quote_terms(message, limit=1)
        if not anchor:
            return _status_text(AgentStatusPhase.RECALLING, message)
        return f"翻了翻记忆，还没找到和{anchor}直接相关的…"
    top = recalled[0]
    date_text = f"{top.memory.occurred_at.month}月{top.memory.occurred_at.day}日"
    anchor = _memory_anchor(top.memory.summary)
    if top.memory.type is MemoryType.CORRECTION:
        about = f"（关于{anchor}）" if anchor else ""
        return f"翻到你 {date_text} 纠正过我的一次{about}…"
    if len(recalled) >= 2:
        latest = f"，最近是 {date_text} 的{anchor}" if anchor else ""
        return f"翻到 {len(recalled)} 条记忆{latest}…"
    if anchor:
        return f"想起 {date_text} 你说的{anchor}…"
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
        self, *, decision: CadenceDecision, context: BuiltContext, message: str = ""
    ) -> AgentPublicReflectionEvent | None:
        if decision.cadence not in {
            ConversationCadence.REFLECTIVE,
            ConversationCadence.RECONSIDERED,
        }:
            return None
        if "memory:0" in decision.evidence_refs and context.retrieved_memories:
            memory = context.retrieved_memories[0].memory
            date_text = f"{memory.occurred_at.month}月{memory.occurred_at.day}日"
            anchor = _memory_anchor(memory.summary)
            if anchor:
                text = f"{anchor}在 {date_text} 也出现过，和这次说的可能有关——先当参考，不当结论。"
            else:
                text = f"{date_text} 那次的事和这次可能有关——先当参考，不当结论。"
            return AgentPublicReflectionEvent(text=text, evidence_refs=["memory:0"])
        anchor = quote_terms(message, limit=1)
        if anchor:
            text = f"关于{anchor}，我想到的不止一种可能，先不下结论。"
        else:
            text = "我有一个还不太确定的猜测：这件事可能不只是一种解释。"
        return AgentPublicReflectionEvent(text=text, evidence_refs=["message:current"])


def event_evidence_refs(events: list[AgentPublicEvent]) -> tuple[str, ...]:
    return tuple(
        reference
        for event in events
        if isinstance(event, AgentPublicReflectionEvent)
        for reference in event.evidence_refs
    )
