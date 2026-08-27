from dataclasses import dataclass
from datetime import UTC, datetime
from uuid import uuid4

from reso_agent.contracts import (
    AgentTurnRequest,
    MemoryCandidate,
    MemoryType,
    PersonaPatchCandidate,
    RelationshipUpdateCandidate,
    RetrievedMemory,
)
from reso_agent.pattern.detector import PatternDetector
from reso_agent.runtime.language import fragment_summary, quote_terms


@dataclass(frozen=True)
class ReflectionResult:
    memory_candidates: tuple[MemoryCandidate, ...]
    persona_patch_candidates: tuple[PersonaPatchCandidate, ...]
    relationship_candidates: tuple[RelationshipUpdateCandidate, ...]


class ReflectionService:
    """Emits reviewable candidates only; Product API remains the commit authority."""

    def __init__(self, pattern_detector: PatternDetector | None = None) -> None:
        self._pattern_detector = pattern_detector or PatternDetector()

    def _corrected_reading(self, retrieved: tuple[RetrievedMemory, ...]) -> str:
        for item in retrieved:
            if item.memory.type is MemoryType.REFLECTION:
                return item.memory.summary
        return "此前的解释"

    def reflect(
        self,
        *,
        request: AgentTurnRequest,
        is_correction: bool,
        retrieved: tuple[RetrievedMemory, ...],
        model_memory: MemoryCandidate | None = None,
    ) -> ReflectionResult:
        memory = self._memory_candidate(request, is_correction, model_memory)

        patches: tuple[PersonaPatchCandidate, ...] = ()
        persona = request.context.persona if request.context else None
        patterns = self._pattern_detector.detect([item.memory for item in retrieved])
        if is_correction and persona is not None:
            corrected_reading = self._corrected_reading(retrieved)
            correction_fragment = fragment_summary(request.message, cap=40) or "见本轮原话"
            patches = (
                PersonaPatchCandidate(
                    id=uuid4(),
                    user_id=request.user_id,
                    from_version_id=persona.version_id,
                    path="/confirmedPatterns/socialRhythm",
                    old_value=corrected_reading,
                    proposed_value=f"以用户本轮的纠正为准：{correction_fragment}",
                    reason="用户明确纠正旧解释；显式 correction 可作为单条强证据。",
                    evidence_ids=[request.request_id],
                    confidence=0.86,
                    created_at=datetime.now(UTC),
                ),
            )
        elif persona is not None and patterns:
            pattern = patterns[0]
            patches = (
                PersonaPatchCandidate(
                    id=uuid4(),
                    user_id=request.user_id,
                    from_version_id=persona.version_id,
                    path=f"/uncertainHypotheses/{pattern.topic[:24]}",
                    old_value=None,
                    proposed_value=pattern.summary,
                    reason=(
                        f"模式检测：{pattern.occurrences} 条相互独立证据反复出现"
                        f"「{pattern.topic}」主题"
                        + (
                            f"，含 {len(pattern.exceptions)} 次用户纠正，置信度相应下调。"
                            if pattern.exceptions
                            else "。"
                        )
                    ),
                    evidence_ids=list(pattern.evidence_ids[:3]),
                    confidence=pattern.confidence,
                    created_at=datetime.now(UTC),
                ),
            )

        relationships: tuple[RelationshipUpdateCandidate, ...] = ()
        if any(marker in request.message for marker in ("关系", "朋友", "她", "他")):
            anchor = quote_terms(request.message, limit=1)
            relationships = (
                RelationshipUpdateCandidate(
                    summary=f"关系话题（{anchor}）：{fragment_summary(request.message, cap=30)}",
                    reason="relationship topic detected; no formal state mutation",
                    confidence=0.58,
                ),
            )
        return ReflectionResult((memory,), patches, relationships)

    def _memory_candidate(
        self,
        request: AgentTurnRequest,
        is_correction: bool,
        model_memory: MemoryCandidate | None,
    ) -> MemoryCandidate:
        if model_memory is not None:
            return MemoryCandidate(
                type=model_memory.type,
                summary=model_memory.summary,
                evidence_message_ids=[request.request_id],
                confidence=model_memory.confidence,
                requires_review=is_correction,
            )
        summary = fragment_summary(request.message) or request.message.strip()[:40]
        return MemoryCandidate(
            type=MemoryType.CORRECTION if is_correction else MemoryType.EPISODIC,
            summary=summary,
            evidence_message_ids=[request.request_id],
            confidence=0.96 if is_correction else 0.72,
            requires_review=is_correction,
        )
