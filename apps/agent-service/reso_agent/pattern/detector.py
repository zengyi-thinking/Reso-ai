from __future__ import annotations

import re
from dataclasses import dataclass
from uuid import UUID

from reso_agent.contracts import MemoryRecord, MemoryType

# Deterministic lexical grounding: shared CJK bigrams and latin terms become
# candidate "recurring topics". This is a baseline detector, not a semantic one.
_STOPGRAMS = {"的时候", "不是自己", "一个", "自己", "还是", "就是", "但是", "然后", "可能"}


def _terms(text: str) -> set[str]:
    normalized = re.sub(r"\s+", "", text.lower())
    latin = set(re.findall(r"[a-z0-9]{2,}", normalized))
    cjk = "".join(re.findall(r"[\u3400-\u9fff]", normalized))
    grams = {cjk[index : index + 2] for index in range(max(0, len(cjk) - 1))}
    return (latin | grams) - _STOPGRAMS


@dataclass(frozen=True)
class PatternObservation:
    """An explainable recurring pattern with evidence and known exceptions."""

    topic: str
    summary: str
    evidence_ids: tuple[UUID, ...]
    occurrences: int
    exceptions: tuple[UUID, ...]
    confidence: float


class PatternDetector:
    """Detects repeated topics across independent evidence memories.

    A pattern needs at least two independent memories sharing a term; explicit
    corrections that mention the same term are recorded as exceptions and lower
    confidence instead of being suppressed silently.
    """

    def detect(self, memories: list[MemoryRecord]) -> list[PatternObservation]:
        evidence = [
            memory
            for memory in memories
            if memory.enabled
            and memory.type
            in {MemoryType.PERSONA_RELATED, MemoryType.REFLECTION, MemoryType.EPISODIC}
        ]
        corrections = [memory for memory in memories if memory.type is MemoryType.CORRECTION]

        term_memories: dict[str, list[MemoryRecord]] = {}
        for memory in evidence:
            for term in _terms(memory.summary):
                term_memories.setdefault(term, []).append(memory)

        observations: list[PatternObservation] = []
        seen_evidence: set[UUID] = set()
        for term, group in sorted(term_memories.items(), key=lambda item: (-len(item[1]), item[0])):
            distinct = {memory.id: memory for memory in group}
            if len(distinct) < 2 or set(distinct) & seen_evidence:
                continue
            exception_ids = tuple(
                correction.id for correction in corrections if term in _terms(correction.summary)
            )
            occurrences = len(distinct)
            confidence = round(min(0.85, 0.45 + 0.12 * occurrences) - 0.1 * len(exception_ids), 2)
            if len(exception_ids) >= occurrences:
                # The user has explicitly denied this reading more often than it occurred.
                continue
            topic_label = term
            summary = (
                f"用户在 {occurrences} 条相互独立的证据中反复出现「{topic_label}」相关主题"
                + (
                    f"；已有 {len(exception_ids)} 次明确纠正，需保留不确定性。"
                    if exception_ids
                    else "。"
                )
            )
            observations.append(
                PatternObservation(
                    topic=term,
                    summary=summary,
                    evidence_ids=tuple(distinct.keys())[:4],
                    occurrences=occurrences,
                    exceptions=exception_ids,
                    confidence=max(0.3, confidence),
                )
            )
            seen_evidence |= set(distinct)
        return observations
