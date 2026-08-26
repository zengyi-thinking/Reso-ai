from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from uuid import UUID, uuid4

from reso_agent.context.builder import BuiltContext, ContextBuilder
from reso_agent.contracts import (
    AgentAuthorizedContext,
    AgentMode,
    AgentTurnRequest,
    AgentTurnResponse,
    ModelMetadata,
)
from reso_agent.models.provider import (
    DeterministicModelProvider,
    ModelProvider,
    ModelRequest,
)
from reso_agent.policy.disclosure import DisclosurePolicy, DisclosureResult, PolicyDecision
from reso_agent.reflection.service import ReflectionResult, ReflectionService
from reso_agent.runtime.mode_router import ModeRouter, ModeSelection, TurnPerception
from reso_agent.tracing.trace import TraceRecord

_PROMPT_ROOT = Path(__file__).parents[1] / "prompts"


@dataclass(frozen=True)
class RuntimeTurnDetails:
    response: AgentTurnResponse
    trace: TraceRecord
    perception: TurnPerception
    selection: ModeSelection
    context: BuiltContext
    model: ModelMetadata
    reflection: ReflectionResult


class AgentRuntime:
    """Controlled runtime: authorized reads in, candidates out, no Product DB writes."""

    def __init__(
        self,
        *,
        model_provider: ModelProvider | None = None,
        policy: DisclosurePolicy | None = None,
        mode_router: ModeRouter | None = None,
        context_builder: ContextBuilder | None = None,
        reflection: ReflectionService | None = None,
    ) -> None:
        self._model_provider = model_provider or DeterministicModelProvider()
        self._policy = policy or DisclosurePolicy()
        self._mode_router = mode_router or ModeRouter()
        self._context_builder = context_builder or ContextBuilder()
        self._reflection = reflection or ReflectionService()

    async def turn(self, request: AgentTurnRequest) -> tuple[AgentTurnResponse, TraceRecord]:
        details = await self.turn_with_details(request)
        return details.response, details.trace

    async def turn_with_details(self, request: AgentTurnRequest) -> RuntimeTurnDetails:
        perception = self._mode_router.perceive(request.message)
        selection = self._mode_router.route(request, perception)
        authorized = request.context or AgentAuthorizedContext()
        context = self._context_builder.build(message=request.message, authorized=authorized)
        policy = self._policy.decide(
            proxy_requested=selection.mode is AgentMode.PROXY,
            active_consent=False,
        )
        version = "v1" if selection.mode is AgentMode.PROXY else "v2"
        prompt_version = f"{selection.mode.value}/{version}"

        if policy.decision is PolicyDecision.ASK_USER:
            message = "在代表你行动之前，我需要你明确授权这次代理范围。"
            model = ModelMetadata(
                provider="policy",
                model="not-called",
                latency_ms=0,
                prompt_tokens=None,
                completion_tokens=None,
            )
            reflection = ReflectionResult((), (), ())
        else:
            mode_prompt = (_PROMPT_ROOT / selection.mode.value / f"{version}.md").read_text(
                encoding="utf-8"
            )
            model_response = await self._model_provider.generate(
                ModelRequest(
                    mode=selection.mode,
                    system_prompt=(
                        f"{context.system_context}\n\n[Mode Contract]\n{mode_prompt}\n\n"
                        "Never reveal private chain-of-thought. "
                        "Return only the user-facing response. Follow the length limit strictly."
                    ),
                    user_message=request.message,
                    recent_messages=context.recent_messages,
                    memory_summaries=tuple(
                        item.memory.summary for item in context.retrieved_memories
                    ),
                    is_correction=perception.is_correction,
                    no_analysis=perception.no_analysis,
                )
            )
            message = model_response.content
            model = model_response.metadata
            reflection = self._reflection.reflect(
                request=request,
                is_correction=perception.is_correction,
                retrieved=context.retrieved_memories,
            )

        trace_id = uuid4()
        response = AgentTurnResponse(
            request_id=request.request_id,
            message=message,
            mode=selection.mode,
            memory_candidates=list(reflection.memory_candidates),
            persona_patch_candidates=list(reflection.persona_patch_candidates),
            relationship_candidates=list(reflection.relationship_candidates),
            trace_id=trace_id,
        )
        trace = self._trace(
            request=request,
            trace_id=trace_id,
            selection=selection,
            context=context,
            policy=policy,
            model=model,
            prompt_version=prompt_version,
            response=response,
        )
        return RuntimeTurnDetails(
            response=response,
            trace=trace,
            perception=perception,
            selection=selection,
            context=context,
            model=model,
            reflection=reflection,
        )

    def _trace(
        self,
        *,
        request: AgentTurnRequest,
        trace_id: UUID,
        selection: ModeSelection,
        context: BuiltContext,
        policy: DisclosureResult,
        model: ModelMetadata,
        prompt_version: str,
        response: AgentTurnResponse,
    ) -> TraceRecord:
        return TraceRecord(
            trace_id=trace_id,
            request_id=request.request_id,
            mode=selection.mode,
            mode_reason=selection.reason,
            policy_decision=policy.decision,
            policy_reason=policy.reason_code,
            prompt_version=prompt_version,
            model_route=model.provider,
            model=model.model,
            latency_ms=model.latency_ms,
            prompt_tokens=model.prompt_tokens,
            completion_tokens=model.completion_tokens,
            persona_version=context.selected_persona.version,
            persona_fields=tuple(context.selected_persona.fields),
            retrieved_memory_ids=tuple(context.summary.memory_ids),
            memory_candidate_count=len(response.memory_candidates),
            persona_candidate_count=len(response.persona_patch_candidates),
            persona_candidate_ids=tuple(item.id for item in response.persona_patch_candidates),
        )
