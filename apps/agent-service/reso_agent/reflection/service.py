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


@dataclass(frozen=True)
class ReflectionResult:
    memory_candidates: tuple[MemoryCandidate, ...]
    persona_patch_candidates: tuple[PersonaPatchCandidate, ...]
    relationship_candidates: tuple[RelationshipUpdateCandidate, ...]


class ReflectionService:
    """Emits reviewable candidates only; Product API remains the commit authority."""

    def reflect(
        self,
        *,
        request: AgentTurnRequest,
        is_correction: bool,
        retrieved: tuple[RetrievedMemory, ...],
    ) -> ReflectionResult:
        memory_type = MemoryType.CORRECTION if is_correction else MemoryType.EPISODIC
        memory = MemoryCandidate(
            type=memory_type,
            summary=(
                "用户明确纠正：并非普遍慢热，而是排斥无意义社交。"
                if is_correction
                else self._episodic_summary(request.message)
            ),
            evidence_message_ids=[request.request_id],
            confidence=0.96 if is_correction else 0.72,
            requires_review=is_correction,
        )

        patches: tuple[PersonaPatchCandidate, ...] = ()
        persona = request.context.persona if request.context else None
        if is_correction and persona is not None:
            patches = (
                PersonaPatchCandidate(
                    id=uuid4(),
                    user_id=request.user_id,
                    from_version_id=persona.version_id,
                    path="/confirmedPatterns/socialRhythm",
                    old_value="用户比较慢热",
                    proposed_value=(
                        "用户并非普遍慢热；更在意互动是否有真实内容，"
                        "面对真正感兴趣的人可以很快进入深度交流。"
                    ),
                    reason="用户明确纠正旧解释；显式 correction 可作为单条强证据。",
                    evidence_ids=[request.request_id],
                    confidence=0.86,
                    created_at=datetime.now(UTC),
                ),
            )
        elif persona is not None and self._has_multiple_consistent_evidence(retrieved):
            evidence = [item.memory.id for item in retrieved[:3]]
            patches = (
                PersonaPatchCandidate(
                    id=uuid4(),
                    user_id=request.user_id,
                    from_version_id=persona.version_id,
                    path="/uncertainHypotheses/meaningfulConversation",
                    old_value=None,
                    proposed_value="用户持续偏好有具体内容的深入交流。",
                    reason="至少两条相互独立且一致的 persona-related evidence。",
                    evidence_ids=evidence,
                    confidence=0.74,
                    created_at=datetime.now(UTC),
                ),
            )

        relationships: tuple[RelationshipUpdateCandidate, ...] = ()
        if any(marker in request.message for marker in ("关系", "朋友", "她", "他")):
            relationships = (
                RelationshipUpdateCandidate(
                    summary="本轮包含关系相关经历，等待 Product API 审查。",
                    reason="relationship topic detected; no formal state mutation",
                    confidence=0.58,
                ),
            )
        return ReflectionResult((memory,), patches, relationships)

    def _episodic_summary(self, message: str) -> str:
        if any(marker in message for marker in ("累", "疲惫", "没劲")):
            return "用户今天感到疲惫，希望减少额外负担。"
        if any(marker in message for marker in ("开心", "完成", "进展")):
            return "用户分享了一个让自己开心或有进展的经历。"
        if any(marker in message for marker in ("怎么说", "怎么回复", "不知道怎么")):
            return "用户希望先整理自己的真实表达。"
        return "用户分享了一段当前经历。"

    def _has_multiple_consistent_evidence(self, retrieved: tuple[RetrievedMemory, ...]) -> bool:
        relevant = [
            item
            for item in retrieved
            if item.memory.type in {MemoryType.PERSONA_RELATED, MemoryType.REFLECTION}
            and item.score.semantic >= 0.08
        ]
        return len(relevant) >= 2
