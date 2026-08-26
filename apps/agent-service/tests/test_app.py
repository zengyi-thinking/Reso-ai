from uuid import uuid4

from fastapi.testclient import TestClient

from reso_agent.app import app

client = TestClient(app)


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
    assert payload["mode"] == "mirror"
    assert payload["memoryCandidates"][0]["type"] == "correction"
    assert payload["personaPatchCandidates"] == []


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
