from uuid import uuid4

from fastapi.testclient import TestClient

from reso_agent.app import app


def test_quick_start_persona_keeps_type_labels_as_weak_identity_evidence() -> None:
    response = TestClient(app).post(
        "/v1/persona/quick-start",
        json={
            "requestId": str(uuid4()),
            "answers": {
                "mbti": "INFJ",
                "zodiac": "双鱼座",
                "relationshipGoal": "建立真诚的长期关系",
                "communicationPreference": "有内容、直接但温和",
                "socialPreference": "少量但深入的交流",
            },
        },
    )
    assert response.status_code == 200
    body = response.json()
    assert body["content"]["identity"] == {"mbti": "INFJ", "zodiac": "双鱼座"}
    assert body["content"]["relationshipNeeds"] == ["建立真诚的长期关系"]
    assert body["content"]["uncertainHypotheses"]
