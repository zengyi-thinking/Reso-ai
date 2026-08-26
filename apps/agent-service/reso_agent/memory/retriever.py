from __future__ import annotations

import math
import re
from datetime import UTC, datetime

from reso_agent.contracts import MemoryRecord, MemoryType, RetrievalScore, RetrievedMemory

_TYPE_WEIGHT = {
    MemoryType.CORRECTION: 0.22,
    MemoryType.PERSONA_RELATED: 0.12,
    MemoryType.RELATIONSHIP: 0.12,
    MemoryType.REFLECTION: 0.08,
    MemoryType.EPISODIC: 0.05,
}


def _terms(text: str) -> set[str]:
    normalized = re.sub(r"\s+", "", text.lower())
    latin = set(re.findall(r"[a-z0-9]{2,}", normalized))
    cjk = "".join(re.findall(r"[\u3400-\u9fff]", normalized))
    grams = {cjk[index : index + 2] for index in range(max(0, len(cjk) - 1))}
    return latin | grams


class MemoryRetriever:
    """Explainable lexical baseline with explicit correction conflict handling."""

    def retrieve(
        self,
        *,
        query: str,
        memories: list[MemoryRecord],
        top_k: int = 5,
        now: datetime | None = None,
    ) -> list[RetrievedMemory]:
        reference_time = now or datetime.now(UTC)
        query_terms = _terms(query)
        scored: list[RetrievedMemory] = []

        for memory in memories:
            if not memory.enabled:
                continue
            memory_terms = _terms(" ".join([memory.summary, *memory.topics]))
            overlap = len(query_terms & memory_terms)
            union = len(query_terms | memory_terms)
            semantic_raw = overlap / union if union else 0.0
            topic_hit = any(topic.lower() in query.lower() for topic in memory.topics)
            if semantic_raw < 0.025 and not topic_hit:
                continue

            age_days = max(0.0, (reference_time - memory.occurred_at).total_seconds() / 86400)
            semantic = round(min(0.55, semantic_raw * 1.6), 4)
            recency = round(0.15 * math.exp(-age_days / 90), 4)
            importance = round(memory.importance * 0.2, 4)
            type_weight = _TYPE_WEIGHT[memory.type]
            relationship = round(memory.relationship_relevance * 0.1, 4)
            correction_boost = 0.35 if memory.type is MemoryType.CORRECTION else 0.0
            final = round(
                semantic + recency + importance + type_weight + relationship + correction_boost,
                4,
            )
            reason_parts = [
                f"semantic={semantic:.2f}",
                f"recency={recency:.2f}",
                f"importance={importance:.2f}",
                f"type={type_weight:.2f}",
            ]
            if relationship:
                reason_parts.append(f"relationship={relationship:.2f}")
            if correction_boost:
                reason_parts.append("correction override +0.35")
            scored.append(
                RetrievedMemory(
                    memory=memory,
                    score=RetrievalScore(
                        semantic=semantic,
                        recency=recency,
                        importance=importance,
                        type=type_weight,
                        relationship=relationship,
                        correction_boost=correction_boost,
                        final=final,
                        reason=", ".join(reason_parts),
                    ),
                )
            )

        corrections = [item for item in scored if item.memory.type is MemoryType.CORRECTION]
        suppressed_ids = {
            conflict_id
            for correction in corrections
            for conflict_id in correction.memory.conflicts_with
        }
        filtered = [item for item in scored if item.memory.id not in suppressed_ids]
        return sorted(filtered, key=lambda item: (-item.score.final, str(item.memory.id)))[:top_k]
