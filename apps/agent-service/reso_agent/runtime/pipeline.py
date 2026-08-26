from dataclasses import dataclass
from uuid import UUID, uuid4

from reso_agent.contracts import (
    AgentMode,
    AgentTurnRequest,
    AgentTurnResponse,
    MemoryCandidate,
    MemoryType,
)
from reso_agent.policy.disclosure import DisclosurePolicy, DisclosureResult, PolicyDecision
from reso_agent.tracing.trace import TraceRecord


@dataclass(frozen=True)
class TurnPerception:
    is_correction: bool


@dataclass(frozen=True)
class AuthorizedContext:
    persona_version_id: UUID | None
    retrieved_memory_ids: tuple[UUID, ...]
    active_proxy_consent: bool


@dataclass(frozen=True)
class RuntimeRoute:
    mode: AgentMode
    prompt_version: str
    model_route: str
    tool_names: tuple[str, ...]


@dataclass(frozen=True)
class TurnPlan:
    route: RuntimeRoute
    policy: DisclosureResult
    message: str
    memory_candidates: tuple[MemoryCandidate, ...]


class ModeRouter:
    """Select a bounded mode and versioned prompt independently from provider routing."""

    def route(self, request: AgentTurnRequest, perception: TurnPerception) -> RuntimeRoute:
        mode = request.requested_mode or (
            AgentMode.MIRROR if perception.is_correction else AgentMode.COMPANION
        )
        return RuntimeRoute(
            mode=mode,
            prompt_version=f"{mode.value}/v1",
            model_route="deterministic-bootstrap",
            tool_names=(),
        )


class AgentRuntime:
    """Typed deterministic pipeline; no Product DB mutation or paid model call occurs here."""

    def __init__(
        self,
        policy: DisclosurePolicy | None = None,
        mode_router: ModeRouter | None = None,
    ) -> None:
        self._policy = policy or DisclosurePolicy()
        self._mode_router = mode_router or ModeRouter()

    async def turn(self, request: AgentTurnRequest) -> tuple[AgentTurnResponse, TraceRecord]:
        perception = self._perceive(request)
        context = self._build_authorized_context(request)
        plan = self._plan(request, perception, context)
        return self._post_turn(request, context, plan)

    def _perceive(self, request: AgentTurnRequest) -> TurnPerception:
        is_correction = any(
            marker in request.message.lower() for marker in ("不是", "不对", "not really")
        )
        return TurnPerception(is_correction=is_correction)

    def _build_authorized_context(self, request: AgentTurnRequest) -> AuthorizedContext:
        # A future Product API read port may populate these fields after authorization.
        return AuthorizedContext(
            persona_version_id=request.persona_version_id,
            retrieved_memory_ids=(),
            active_proxy_consent=False,
        )

    def _plan(
        self,
        request: AgentTurnRequest,
        perception: TurnPerception,
        context: AuthorizedContext,
    ) -> TurnPlan:
        route = self._mode_router.route(request, perception)
        policy = self._policy.decide(
            proxy_requested=route.mode is AgentMode.PROXY,
            active_consent=context.active_proxy_consent,
        )

        if policy.decision is PolicyDecision.ASK_USER:
            message = "在代表你行动之前，我需要你明确授权这次代理范围。"
        elif perception.is_correction:
            message = "谢谢你纠正我。我会记住这次纠正，但不会把一次表达直接写成人格结论。"
        else:
            message = "听起来你今天需要一点轻松的空间。我们可以先不分析，只慢一点聊。"

        candidate = MemoryCandidate(
            type=(MemoryType.CORRECTION if perception.is_correction else MemoryType.EPISODIC),
            summary=(
                "User explicitly corrected a prior interpretation."
                if perception.is_correction
                else "User shared a current experience."
            ),
            confidence=0.95 if perception.is_correction else 0.7,
            requires_review=perception.is_correction,
        )
        return TurnPlan(
            route=route,
            policy=policy,
            message=message,
            memory_candidates=(candidate,),
        )

    def _post_turn(
        self,
        request: AgentTurnRequest,
        context: AuthorizedContext,
        plan: TurnPlan,
    ) -> tuple[AgentTurnResponse, TraceRecord]:
        trace_id = uuid4()
        response = AgentTurnResponse(
            request_id=request.request_id,
            message=plan.message,
            mode=plan.route.mode,
            memory_candidates=list(plan.memory_candidates),
            persona_patch_candidates=[],
            trace_id=trace_id,
        )
        trace = TraceRecord(
            trace_id=trace_id,
            request_id=request.request_id,
            mode=plan.route.mode,
            policy_decision=plan.policy.decision,
            prompt_version=plan.route.prompt_version,
            model_route=plan.route.model_route,
            tool_names=plan.route.tool_names,
            retrieved_memory_ids=context.retrieved_memory_ids,
            memory_candidate_count=len(response.memory_candidates),
            persona_candidate_count=len(response.persona_patch_candidates),
        )
        return response, trace
