import json
from pathlib import Path
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError

from reso_agent.app import app
from reso_agent.contracts import AgentTurnRequest, AgentTurnResponse, PersonalManualContent

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


def test_product_turn_stream_emits_public_progress_then_a_result() -> None:
    identifier = str(uuid4())
    with client.stream(
        "POST",
        "/v1/agent/turn/stream",
        json={
            "requestId": identifier,
            "userId": identifier,
            "agentId": identifier,
            "conversationId": identifier,
            "message": "帮我认真看看我们适不适合",
            "personaVersionId": None,
            "publicProcessMode": "relationship_deep_dive",
        },
    ) as response:
        body = "".join(response.iter_text())

    assert response.status_code == 200
    assert '"type":"status"' in body
    assert '"type":"result"' in body
    assert '"publicProcessMode"' not in body


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


def test_shared_personal_manual_fixtures_match_python_contract() -> None:
    valid = json.loads(
        (FIXTURE_DIRECTORY / "personal-manual.valid.json").read_text(encoding="utf-8")
    )
    invalid = json.loads(
        (FIXTURE_DIRECTORY / "personal-manual.invalid.json").read_text(encoding="utf-8")
    )
    assert len(PersonalManualContent.model_validate(valid).variables) == 9
    with pytest.raises(ValidationError):
        PersonalManualContent.model_validate(invalid)


def test_personal_manual_generate_uses_configured_provider_and_preserves_evidence_refs() -> None:
    journey_id = str(uuid4())
    evidence_snapshot_id = str(uuid4())
    trace_id = str(uuid4())
    evidence = [
        {
            "evidenceRef": f"mountain-v1/q{index}/c{index}@{uuid4()}",
            "journeyVersion": "mountain-v1",
            "stageId": f"q{index}",
            "questionId": f"q{index}",
            "choiceId": f"c{index}",
            "optionText": "一个由服务端登记的选项",
            "responseText": None,
            "target": "self",
            "summary": "在当前场景中表现出一种可继续验证的偏好",
            "signals": [{"dimension": "support", "value": "observed", "weight": 1}],
            "contextTags": ["test"],
            "pressure": "medium",
            "companionMood": None,
            "elapsedMs": 100,
            "answeredAt": "2026-08-27T08:00:00+08:00",
        }
        for index in range(7)
    ]
    response = client.post(
        "/v1/personal-manual/generate",
        json={
            "requestId": str(uuid4()),
            "journeyId": journey_id,
            "journeyVersion": "mountain-v1",
            "evidenceSnapshotId": evidence_snapshot_id,
            "evidenceSignature": "a" * 64,
            "evidence": evidence,
            "traceId": trace_id,
        },
    )
    assert response.status_code == 200
    payload = response.json()
    assert payload["traceId"] == trace_id
    assert len(payload["variables"]) == 9
    assert len(payload["sections"]) == 5
    allowed_refs = {item["evidenceRef"] for item in evidence}
    assert all(
        set(item["evidenceRefs"]).issubset(allowed_refs)
        for item in [*payload["variables"], *payload["sections"]]
    )


def test_persona_initialize_derives_hypotheses_from_journey_answers() -> None:
    user_id = str(uuid4())
    journey_id = str(uuid4())
    response = client.post(
        "/v1/persona/initialize",
        json={
            "userId": user_id,
            "journeyId": journey_id,
            "answers": [
                {"questionId": "q1", "choiceId": "安静角落"},
                {"questionId": "q2", "choiceId": "安静角落"},
                {"questionId": "q3", "choiceId": "主动帮忙"},
            ],
        },
    )
    assert response.status_code == 200
    payload = response.json()
    assert payload["confirmedByUser"] is False
    hypotheses = payload["content"]["uncertainHypotheses"]
    assert len(hypotheses) == 2
    repeated = next(h for h in hypotheses if "2 个 Journey" in h or "稳定偏好" in h)
    assert "安静角落" in repeated
    single = next(h for h in hypotheses if "单次证据" in h)
    assert "主动帮忙" in single
    assert payload["changeSummary"].startswith("Initialized from Journey answers")


def test_product_assist_contracts_use_the_configured_provider() -> None:
    request_id = str(uuid4())
    requester_id = str(uuid4())
    connection_id = str(uuid4())
    message_id = str(uuid4())
    sender_id = str(uuid4())
    agent_id = str(uuid4())
    trace_id = str(uuid4())

    analyzed = client.post(
        "/v1/assist/analyze",
        json={
            "requestId": request_id,
            "idempotencyKey": "assist:analyze:1",
            "requesterUserId": requester_id,
            "connectionId": connection_id,
            "sourceMessageId": message_id,
            "sourceText": "周末要不要找家安静的咖啡馆？",
            "senderUserId": sender_id,
            "agentId": agent_id,
            "traceId": trace_id,
        },
    )
    assert analyzed.status_code == 200
    assert analyzed.json()["traceId"] == trace_id
    assert analyzed.json()["replyRoutes"]

    polished = client.post(
        "/v1/assist/polish",
        json={
            "requestId": str(uuid4()),
            "idempotencyKey": "assist:polish:1",
            "requesterUserId": requester_id,
            "connectionId": connection_id,
            "draft": "好啊，什么时候？",
            "replyToMessageId": message_id,
            "agentId": agent_id,
            "traceId": trace_id,
        },
    )
    assert polished.status_code == 200
    assert polished.json()["traceId"] == trace_id
    assert polished.json()["candidates"]


def test_tea_party_v1_is_separate_from_legacy_social_contract() -> None:
    mission_id = str(uuid4())
    connection_id = str(uuid4())
    speaker_id = str(uuid4())
    listener_id = str(uuid4())
    trace_id = str(uuid4())
    acted = client.post(
        "/v1/tea-party/act",
        json={
            "missionId": mission_id,
            "connectionId": connection_id,
            "turnNo": 8,
            "speakerAgentId": speaker_id,
            "listenerAgentId": listener_id,
            "priorMessages": [],
            "disclosureLevel": "L2_SOCIAL",
            "maxContentLength": 2000,
            "idempotencyKey": "mission:turn:8",
            "traceId": trace_id,
        },
    )
    assert acted.status_code == 200
    assert acted.json()["speakerAgentId"] == speaker_id
    assert acted.json()["disclosure"] == {
        "decision": "ALLOW",
        "level": "L2_SOCIAL",
        "reasonCode": "product-authorized-l2",
    }
    assert acted.json()["stopReason"] == "max_turns"

    evaluated = client.post(
        "/v1/tea-party/evaluate",
        json={
            "missionId": mission_id,
            "messages": [
                {
                    "id": str(uuid4()),
                    "turnNo": 1,
                    "speakerAgentId": speaker_id,
                    "content": acted.json()["content"],
                    "createdAt": "2026-08-26T08:00:00+08:00",
                }
            ],
            "traceId": trace_id,
        },
    )
    assert evaluated.status_code == 200
    assert evaluated.json()["traceId"] == trace_id
    assert evaluated.json()["summary"]["conversationStarter"]
