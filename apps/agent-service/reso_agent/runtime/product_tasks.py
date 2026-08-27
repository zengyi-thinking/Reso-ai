from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any, Literal

from pydantic import BaseModel, Field, ValidationError

from reso_agent.contracts import (
    AgentMode,
    AnalyzeIncomingRequest,
    AnalyzeIncomingResponse,
    DisclosureDecisionV1,
    PersonalManualCandidate,
    PersonalManualContent,
    PersonalManualGenerationRequest,
    PolishCandidate,
    PolishDraftRequest,
    PolishDraftResponse,
    ReplyRoute,
    SocialActRequestV1,
    SocialActResponseV1,
    SocialEvaluateRequestV1,
    SocialEvaluateResponseV1,
    TeaPartySummary,
)
from reso_agent.models.provider import ModelProvider, ModelProviderError, ModelRequest

_PROMPT_ROOT = Path(__file__).parents[1] / "prompts"


class _AnalyzePlan(BaseModel):
    interpretation: str = Field(min_length=1, max_length=4_000)
    replyRoutes: list[dict[str, str]] = Field(max_length=5)


class _PolishPlan(BaseModel):
    candidates: list[dict[str, str]] = Field(min_length=1, max_length=5)


class _SocialActPlan(BaseModel):
    content: str = Field(min_length=1, max_length=2_000)
    shouldStop: bool = False
    stopReason: str | None = None


class _SocialSummaryPlan(BaseModel):
    headline: str = Field(min_length=1, max_length=300)
    conversationStarter: str = Field(min_length=1, max_length=500)


class ProductTaskRuntime:
    """Runs Product-owned Agent tasks through the configured real provider."""

    def __init__(self, provider: ModelProvider) -> None:
        self._provider = provider

    async def analyze_incoming(self, request: AnalyzeIncomingRequest) -> AnalyzeIncomingResponse:
        raw = await self._generate(
            prompt="assist_analyze/v1.md",
            phase="assist_analyze",
            mode=AgentMode.MIRROR,
            payload={"sourceText": request.source_text},
        )
        try:
            plan = _AnalyzePlan.model_validate(self._json_object(raw))
            routes = [ReplyRoute.model_validate(route) for route in plan.replyRoutes]
        except (ValidationError, ValueError) as error:
            raise ModelProviderError("MiniMax returned an invalid Assist analysis") from error
        return AnalyzeIncomingResponse(
            interpretation=plan.interpretation,
            reply_routes=routes,
            trace_id=request.trace_id,
        )

    async def polish_draft(self, request: PolishDraftRequest) -> PolishDraftResponse:
        raw = await self._generate(
            prompt="assist_polish/v1.md",
            phase="assist_polish",
            mode=AgentMode.PREPROCESSOR,
            payload={"draft": request.draft},
        )
        try:
            plan = _PolishPlan.model_validate(self._json_object(raw))
            candidates = [PolishCandidate.model_validate(item) for item in plan.candidates]
        except (ValidationError, ValueError) as error:
            raise ModelProviderError("MiniMax returned an invalid draft polish result") from error
        return PolishDraftResponse(candidates=candidates, trace_id=request.trace_id)

    async def generate_personal_manual(
        self, request: PersonalManualGenerationRequest
    ) -> PersonalManualCandidate:
        raw = await self._generate(
            prompt="personal_manual_generate/v1.md",
            phase="personal_manual_generate",
            mode=AgentMode.MIRROR,
            payload={
                "journeyVersion": request.journey_version,
                "evidence": [
                    item.model_dump(by_alias=True, mode="json") for item in request.evidence
                ],
            },
            max_output_tokens=2_400,
        )
        try:
            payload = self._json_object(raw)
            self._clip_personal_manual_text(payload)
            plan = PersonalManualContent.model_validate(payload)
        except (ValidationError, ValueError) as error:
            raise ModelProviderError("MiniMax returned an invalid Personal Manual") from error
        return PersonalManualCandidate(
            variables=plan.variables,
            sections=plan.sections,
            update_summary=plan.update_summary,
            trace_id=request.trace_id,
            agent_version_id=None,
            model_version="personal-manual-v1",
        )

    async def act_socially(self, request: SocialActRequestV1) -> SocialActResponseV1:
        raw = await self._generate(
            prompt="social_act/v1.md",
            phase="tea_party_act",
            mode=AgentMode.PROXY,
            payload={
                "turnNo": request.turn_no,
                "priorMessages": [
                    {"speakerAgentId": str(item.speaker_agent_id), "content": item.content}
                    for item in request.prior_messages
                ],
            },
        )
        try:
            plan = _SocialActPlan.model_validate(self._json_object(raw))
        except (ValidationError, ValueError) as error:
            raise ModelProviderError("MiniMax returned an invalid Tea Party turn") from error
        content = plan.content[: request.max_content_length]
        stop_reason: Literal["max_turns", "agent_requested"] | None
        if plan.stopReason == "max_turns":
            stop_reason = "max_turns"
        elif plan.stopReason == "agent_requested":
            stop_reason = "agent_requested"
        else:
            stop_reason = None
        should_stop = plan.shouldStop or request.turn_no >= 8
        if request.turn_no >= 8:
            stop_reason = "max_turns"
        elif should_stop and stop_reason is None:
            stop_reason = "agent_requested"
        return SocialActResponseV1(
            speaker_agent_id=request.speaker_agent_id,
            content=content,
            disclosure=DisclosureDecisionV1(
                decision="ALLOW", level="L2_SOCIAL", reason_code="product-authorized-l2"
            ),
            should_stop=should_stop,
            stop_reason=stop_reason,
            trace_id=request.trace_id,
            agent_version_id=None,
        )

    async def evaluate_social(self, request: SocialEvaluateRequestV1) -> SocialEvaluateResponseV1:
        raw = await self._generate(
            prompt="social_evaluate/v1.md",
            phase="tea_party_evaluate",
            mode=AgentMode.MIRROR,
            payload={
                "messages": [
                    {"speakerAgentId": str(item.speaker_agent_id), "content": item.content}
                    for item in request.messages
                ]
            },
        )
        try:
            plan = _SocialSummaryPlan.model_validate(self._json_object(raw))
        except (ValidationError, ValueError) as error:
            raise ModelProviderError("MiniMax returned an invalid Tea Party summary") from error
        return SocialEvaluateResponseV1(
            summary=TeaPartySummary(
                headline=plan.headline,
                conversation_starter=plan.conversationStarter,
            ),
            trace_id=request.trace_id,
        )

    async def _generate(
        self,
        *,
        prompt: str,
        phase: str,
        mode: AgentMode,
        payload: dict[str, Any],
        max_output_tokens: int = 700,
    ) -> str:
        system_prompt = (_PROMPT_ROOT / prompt).read_text(encoding="utf-8")
        response = await self._provider.generate(
            ModelRequest(
                mode=mode,
                system_prompt=system_prompt,
                user_message=json.dumps(payload, ensure_ascii=False),
                recent_messages=(),
                memory_summaries=(),
                is_correction=False,
                no_analysis=False,
                generation_phase=phase,
                max_output_tokens=max_output_tokens,
            )
        )
        return response.content

    @staticmethod
    def _json_object(raw: str) -> dict[str, Any]:
        cleaned = re.sub(r"^```(?:json)?\s*|\s*```$", "", raw.strip(), flags=re.IGNORECASE)
        value = json.loads(cleaned)
        if not isinstance(value, dict):
            raise ValueError("Agent task output must be a JSON object")
        return value

    @staticmethod
    def _clip_personal_manual_text(payload: dict[str, Any]) -> None:
        """Enforce public Contract budgets without weakening structure or evidence checks."""

        limits = {
            "name": 80,
            "description": 600,
            "title": 120,
            "content": 1_200,
        }
        for collection_name in ("variables", "sections"):
            collection = payload.get(collection_name)
            if not isinstance(collection, list):
                continue
            for item in collection:
                if not isinstance(item, dict):
                    continue
                for field, limit in limits.items():
                    value = item.get(field)
                    if isinstance(value, str):
                        item[field] = value[:limit]
        summary = payload.get("updateSummary")
        if isinstance(summary, str):
            payload["updateSummary"] = summary[:300]
