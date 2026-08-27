from __future__ import annotations

from collections import Counter
from datetime import UTC, datetime
from uuid import uuid4

from reso_agent.contracts import PersonaContent, PersonaInitializeRequest, PersonaVersion

# Journey choices only ever support hypotheses; they never become conclusions.
_SINGLE_EVIDENCE_CONFIDENCE = 0.55
_REPEATED_EVIDENCE_CONFIDENCE = 0.7


def build_journey_draft(request: PersonaInitializeRequest) -> PersonaVersion:
    """Derive an explainable Persona draft from Journey answers.

    Each distinct choice becomes an uncertain hypothesis citing its question and
    choice IDs; a choice repeated across questions raises confidence but still
    stays a hypothesis pending explicit user confirmation.
    """
    choice_counts = Counter(answer.choice_id for answer in request.answers)
    hypotheses: list[str] = []
    for choice_id, count in choice_counts.most_common():
        related_questions = [
            answer.question_id for answer in request.answers if answer.choice_id == choice_id
        ]
        if count >= 2:
            hypotheses.append(
                f"在 {count} 个 Journey 情境（{', '.join(related_questions[:3])}）中你都选择了"
                f"「{choice_id}」——这可能指向一种稳定偏好，仍需你确认或纠正。"
            )
        else:
            hypotheses.append(
                f"Journey 情境「{related_questions[0]}」中的选择「{choice_id}」："
                "只有单次证据，保留为待验证假设。"
            )

    return PersonaVersion(
        id=uuid4(),
        profile_id=request.user_id,
        version=1,
        content=PersonaContent(uncertain_hypotheses=hypotheses),
        change_summary=(
            f"Initialized from Journey answers "
            f"({len(request.answers)} answers, {len(hypotheses)} hypotheses)"
        ),
        confirmed_by_user=False,
        created_at=datetime.now(UTC),
    )
