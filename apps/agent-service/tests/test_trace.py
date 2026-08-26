from uuid import uuid4

import pytest
from pydantic import ValidationError

from reso_agent.contracts import AgentMode
from reso_agent.policy.disclosure import PolicyDecision
from reso_agent.tracing.trace import TraceRecord


def test_trace_allowlist_rejects_private_reasoning_and_provider_payloads() -> None:
    trace = {
        "trace_id": uuid4(),
        "request_id": uuid4(),
        "mode": AgentMode.COMPANION,
        "policy_decision": PolicyDecision.ALLOW,
        "prompt_version": "companion/v1",
        "model_route": "deterministic-bootstrap",
        "memory_candidate_count": 1,
        "persona_candidate_count": 0,
        "chain_of_thought": "must never be stored",
        "provider_response": {"raw": "must never be stored"},
    }

    with pytest.raises(ValidationError):
        TraceRecord.model_validate(trace)
