from dataclasses import dataclass
from uuid import UUID, uuid4

from reso_agent.contracts import (
    AgentMode,
    AgentTurnRequest,
    AgentTurnResponse,
    MemoryCandidate,
    MemoryType,
)
from reso_agent.policy.disclosure import DisclosurePolicy, PolicyDecision


@dataclass(frozen=True)
class TurnTrace:
    trace_id: UUID
    mode: AgentMode
    policy_decision: PolicyDecision


class AgentRuntime:
    """Deterministic bootstrap runtime; model routing is intentionally not enabled yet."""

    def __init__(self, policy: DisclosurePolicy | None = None) -> None:
        self._policy = policy or DisclosurePolicy()

    async def turn(self, request: AgentTurnRequest) -> tuple[AgentTurnResponse, TurnTrace]:
        is_correction = any(
            marker in request.message.lower() for marker in ("不是", "不对", "not really")
        )
        mode = request.requested_mode or (
            AgentMode.MIRROR if is_correction else AgentMode.COMPANION
        )
        policy = self._policy.decide(
            proxy_requested=mode is AgentMode.PROXY,
            active_consent=False,
        )

        if policy.decision is PolicyDecision.ASK_USER:
            message = "在代表你行动之前，我需要你明确授权这次代理范围。"
        elif is_correction:
            message = "谢谢你纠正我。我会记住这次纠正，但不会把一次表达直接写成人格结论。"
        else:
            message = "听起来你今天需要一点轻松的空间。我们可以先不分析，只慢一点聊。"

        trace_id = uuid4()
        response = AgentTurnResponse(
            request_id=request.request_id,
            message=message,
            mode=mode,
            memory_candidates=[
                MemoryCandidate(
                    type=MemoryType.CORRECTION if is_correction else MemoryType.EPISODIC,
                    summary=(
                        "User explicitly corrected a prior interpretation."
                        if is_correction
                        else "User shared a current experience."
                    ),
                    confidence=0.95 if is_correction else 0.7,
                    requires_review=is_correction,
                )
            ],
            persona_patch_candidates=[],
            trace_id=trace_id,
        )
        return response, TurnTrace(trace_id, mode, policy.decision)
