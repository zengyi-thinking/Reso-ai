from __future__ import annotations

import json
import re
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, Literal
from uuid import UUID, uuid4

from pydantic import BaseModel, Field, ValidationError

from reso_agent.contracts import (
    AgentMode,
    AgentReflectionRequest,
    AgentReflectionResponse,
    MemoryCandidate,
    MemoryType,
    PersonaPatchCandidate,
)
from reso_agent.models.provider import ModelProvider, ModelProviderError, ModelRequest

_PROMPT_ROOT = Path(__file__).parents[1] / "prompts"

_MAX_MEMORY_CANDIDATES = 3
_MAX_PATCH_CANDIDATES = 1

ReflectionFocus = Literal["all", "memories", "patches"]


class _MemoryPlan(BaseModel):
    type: str = Field(min_length=1)
    summary: str = Field(min_length=1)
    evidenceMessageIds: list[UUID] = Field(default_factory=list)
    confidence: float = Field(ge=0, le=1)


class _PatchPlan(BaseModel):
    path: str = Field(min_length=1)
    oldValue: Any = None
    proposedValue: Any = None
    reason: str = Field(min_length=1)
    evidenceIds: list[UUID] = Field(default_factory=list)
    confidence: float = Field(ge=0, le=1)


class _ReflectionPlan(BaseModel):
    memoryCandidates: list[_MemoryPlan] = Field(default_factory=list, max_length=8)
    personaPatchCandidates: list[_PatchPlan] = Field(default_factory=list, max_length=4)


_VALID_MEMORY_TYPES = {"correction", "episodic", "persona_related", "relationship", "reflection"}


class ReflectionTaskRuntime:
    """Batch reflection over an authorized transcript: candidates in, decisions out.

    Mirrors ProductTaskRuntime's discipline - versioned prompt, strict JSON,
    contract-level validation - but emits reviewable candidates instead of a
    ready-to-persist artifact.
    """

    def __init__(self, provider: ModelProvider) -> None:
        self._provider = provider
        self._prompt = (_PROMPT_ROOT / "reflection" / "v1.md").read_text(encoding="utf-8")

    async def reflect(
        self, request: AgentReflectionRequest, *, focus: ReflectionFocus = "all"
    ) -> AgentReflectionResponse:
        payload = {
            "userId": str(request.user_id),
            "conversationId": str(request.conversation_id),
            "messageIds": [str(item) for item in request.message_ids],
            "transcript": [
                {"id": str(item.id), "role": item.role, "content": item.content}
                for item in request.transcript
            ],
            "persona": (
                json.loads(request.persona.model_dump_json(by_alias=True))
                if request.persona is not None
                else None
            ),
            "memories": [
                json.loads(item.model_dump_json(by_alias=True)) for item in request.memories
            ],
            "focus": focus,
        }
        raw = await self._provider.generate(
            ModelRequest(
                mode=AgentMode.MIRROR,
                system_prompt=self._prompt,
                user_message=json.dumps(payload, ensure_ascii=False),
                recent_messages=(),
                memory_summaries=(),
                is_correction=False,
                no_analysis=False,
                generation_phase="reflect",
                max_output_tokens=1200,
            )
        )
        try:
            plan = _ReflectionPlan.model_validate(self._json_object(raw.content))
        except ValidationError as error:
            raise ModelProviderError("MiniMax returned an invalid reflection result") from error
        return self._materialize(request, plan, focus)

    @staticmethod
    def _json_object(raw: str) -> dict[str, Any]:
        stripped = re.sub(r"```(?:json)?", "", raw).strip()
        start = stripped.find("{")
        end = stripped.rfind("}")
        if start == -1 or end == -1 or end < start:
            raise ValueError("no JSON object found")
        parsed = json.loads(stripped[start : end + 1])
        if not isinstance(parsed, dict):
            raise ValueError("expected a JSON object")
        return parsed

    def _materialize(
        self,
        request: AgentReflectionRequest,
        plan: _ReflectionPlan,
        focus: ReflectionFocus,
    ) -> AgentReflectionResponse:
        # Evidence honesty gate: every cited message id must exist in the
        # authorized transcript; anything else would let the batch invent proof.
        known_ids = {row.id for row in request.transcript}
        now = datetime.now(UTC)

        memories: list[MemoryCandidate] = []
        if focus != "patches":
            for memory_plan in plan.memoryCandidates[:_MAX_MEMORY_CANDIDATES]:
                if not memory_plan.summary.strip():
                    continue
                valid_evidence = [mid for mid in memory_plan.evidenceMessageIds if mid in known_ids]
                if not valid_evidence:
                    continue
                if len(valid_evidence) != len(memory_plan.evidenceMessageIds):
                    continue
                if memory_plan.type not in _VALID_MEMORY_TYPES:
                    # Unknown type would silently re-weight retrieval; drop it.
                    continue
                memories.append(
                    MemoryCandidate(
                        type=MemoryType(memory_plan.type),
                        summary=memory_plan.summary,
                        evidence_message_ids=valid_evidence,
                        confidence=memory_plan.confidence,
                        requires_review=True,
                    )
                )

        patches: list[PersonaPatchCandidate] = []
        if request.persona is not None and focus != "memories":
            for patch_plan in plan.personaPatchCandidates[:_MAX_PATCH_CANDIDATES]:
                valid_evidence = [mid for mid in patch_plan.evidenceIds if mid in known_ids]
                if not valid_evidence or len(valid_evidence) != len(patch_plan.evidenceIds):
                    continue
                patches.append(
                    PersonaPatchCandidate(
                        id=uuid4(),
                        user_id=request.user_id,
                        from_version_id=request.persona.version_id,
                        path=patch_plan.path,
                        old_value=patch_plan.oldValue,
                        proposed_value=patch_plan.proposedValue,
                        reason=patch_plan.reason,
                        evidence_ids=valid_evidence,
                        confidence=patch_plan.confidence,
                        status="pending",
                        created_at=now,
                    )
                )

        return AgentReflectionResponse(memory_candidates=memories, persona_patch_candidates=patches)
