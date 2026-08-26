import json
from pathlib import Path
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError

from reso_agent.app import app
from reso_agent.contracts import AgentTurnRequest, AgentTurnResponse

client = TestClient(app)
FIXTURE_DIRECTORY = Path(__file__).parents[3] / "packages" / "contracts" / "fixtures"


def test_health() -> None:
    response = client.get("/v1/health")
    assert response.status_code == 200
    assert response.json() == {"service": "reso-agent", "status": "ok"}


def test_turn_records_correction_without_persona_mutation() -> None:
    identifier = str(uuid4())
    response = client.post(
        "/v1/agent/turn",
        json={
            "requestId": identifier,
            "userId": identifier,
            "agentId": identifier,
            "conversationId": identifier,
            "message": "不是，我只是不喜欢无意义社交。",
            "personaVersionId": None,
        },
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["mode"] == "companion"
    assert payload["memoryCandidates"][0]["type"] == "correction"
    assert payload["personaPatchCandidates"] == []
    assert payload["relationshipCandidates"] == []


def test_proxy_fails_closed_without_consent() -> None:
    identifier = str(uuid4())
    response = client.post(
        "/v1/agent/turn",
        json={
            "requestId": identifier,
            "userId": identifier,
            "agentId": identifier,
            "conversationId": identifier,
            "message": "替我去认识别人",
            "requestedMode": "proxy",
            "personaVersionId": None,
        },
    )

    assert response.status_code == 200
    assert "明确授权" in response.json()["message"]


def test_shared_valid_agent_turn_fixture_matches_python_contract() -> None:
    fixture = json.loads((FIXTURE_DIRECTORY / "agent-turn.valid.json").read_text(encoding="utf-8"))
    request = AgentTurnRequest.model_validate(fixture["request"])
    response = AgentTurnResponse.model_validate(fixture["response"])
    assert request.message
    assert response.mode == "mirror"


def test_shared_invalid_agent_turn_fixture_is_rejected() -> None:
    fixture = json.loads(
        (FIXTURE_DIRECTORY / "agent-turn.invalid.json").read_text(encoding="utf-8")
    )
    with pytest.raises(ValidationError):
        AgentTurnRequest.model_validate(fixture["request"])
    with pytest.raises(ValidationError):
        AgentTurnResponse.model_validate(fixture["response"])
