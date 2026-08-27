import pytest
from fastapi.testclient import TestClient

from reso_agent.app import app
from reso_agent.contracts import LabPatchDecision, LabSessionCreateRequest
from reso_agent.lab import LabWorkspace
from reso_agent.models.provider import DeterministicModelProvider

client = TestClient(app)


def create_session() -> dict[str, object]:
    response = client.post(
        "/v1/lab/sessions",
        json={"userSlug": "user-alice"},
    )
    assert response.status_code == 200
    return response.json()


def test_lab_correction_creates_reviewable_patch_and_preview_only() -> None:
    session = create_session()
    session_id = session["id"]
    response = client.post(
        f"/v1/lab/sessions/{session_id}/turns",
        json={"message": "不是，我只是讨厌无意义社交。"},
    )
    assert response.status_code == 200
    turn = response.json()
    assert turn["mode"] == "companion"
    assert turn["model"]["provider"] == "deterministic"
    assert turn["personaPatchCandidates"][0]["status"] == "pending"
    assert turn["contextSummary"]["recentMessageCount"] == 0
    assert "chainOfThought" not in turn

    patch_id = turn["personaPatchCandidates"][0]["id"]
    decision = client.patch(
        f"/v1/lab/sessions/{session_id}/patches/{patch_id}",
        json={"decision": "accept"},
    )
    assert decision.status_code == 200
    updated = decision.json()
    assert updated["persona"]["version"] == "1.1-preview"
    assert updated["pendingPatches"][0]["status"] == "accepted"


def test_lab_memory_ablation_changes_replay_retrieval() -> None:
    session = create_session()
    session_id = session["id"]
    correction = client.post(
        f"/v1/lab/sessions/{session_id}/turns",
        json={"message": "不是，我只是讨厌无意义社交。"},
    ).json()
    first = client.post(
        f"/v1/lab/sessions/{session_id}/turns",
        json={"message": "你现在还觉得我是慢热吗？"},
    ).json()
    correction_memory = next(
        item
        for item in client.get(f"/v1/lab/sessions/{session_id}").json()["memories"]
        if item["type"] == "correction"
    )
    assert any(
        item["memory"]["id"] == correction_memory["id"] for item in first["retrievedMemories"]
    )

    toggled = client.patch(
        f"/v1/lab/sessions/{session_id}/memories/{correction_memory['id']}",
        json={"enabled": False},
    )
    assert toggled.status_code == 200
    replay = client.post(
        f"/v1/lab/sessions/{session_id}/turns",
        json={"message": "ignored", "replayTurnId": first["id"]},
    ).json()
    assert replay["replayOf"] == first["id"]
    assert all(
        item["memory"]["id"] != correction_memory["id"] for item in replay["retrievedMemories"]
    )
    assert correction["memoryCandidateIds"]


def test_lab_stream_emits_public_events_and_persists_turn() -> None:
    session = create_session()
    session_id = session["id"]
    with client.stream(
        "POST",
        f"/v1/lab/sessions/{session_id}/turns/stream",
        json={"message": "她最近好像不太愿意跟我聊天了。"},
    ) as response:
        body = "".join(response.iter_text())

    assert response.status_code == 200
    assert '"type":"status"' in body
    assert '"type":"message"' in body
    assert '"type":"complete"' in body
    updated = client.get(f"/v1/lab/sessions/{session_id}").json()
    assert len(updated["turns"]) == 1
    assert updated["turns"][0]["publicEvents"]


def test_lab_supports_three_continuous_turns() -> None:
    session = create_session()
    session_id = session["id"]
    counts = []
    for message in ("今天还好吗？", "你记得我刚刚说什么吗？", "那我们继续聊聊。"):
        response = client.post(
            f"/v1/lab/sessions/{session_id}/turns",
            json={"message": message},
        )
        assert response.status_code == 200
        counts.append(response.json()["contextSummary"]["recentMessageCount"])

    assert counts == [0, 2, 4]


@pytest.mark.asyncio
async def test_longitudinal_simulation_becomes_more_specific_after_correction() -> None:
    workspace = LabWorkspace(model_provider=DeterministicModelProvider())
    session = workspace.create_session(LabSessionCreateRequest(user_slug="user-alice"))

    day_1 = await workspace.simulate(session.id, 1)
    day_7 = await workspace.simulate(session.id, 7)
    state_after_correction = workspace.get_session(session.id)
    pending = next(
        item for item in state_after_correction.pending_patches if item.status == "pending"
    )
    workspace.decide_patch(session.id, pending.id, LabPatchDecision(decision="accept"))
    day_30 = await workspace.simulate(session.id, 30)

    assert all(turn.mode.value == "companion" for turn in day_1)
    assert any(turn.mode.value == "preprocessor" for turn in day_7)
    assert any(turn.mode.value == "mirror" for turn in day_30)
    assert any(turn.mode.value == "preprocessor" for turn in day_30)
    assert workspace.get_session(session.id).persona.version == "1.1-preview"
    slow_question = next(turn for turn in day_30 if "慢热" in turn.input)
    assert slow_question.retrieved_memories[0].memory.type.value == "correction"
    assert "你很慢热" not in slow_question.response
    assert all(check.passed for turn in [*day_1, *day_7, *day_30] for check in turn.eval)


def test_lab_stream_emits_deltas_memory_writes_and_grounded_recall() -> None:
    session = create_session()
    session_id = session["id"]
    with client.stream(
        "POST",
        f"/v1/lab/sessions/{session_id}/turns/stream",
        json={"message": "那个长期项目终于完成第一版了，你还记得吗？"},
    ) as response:
        body = "".join(response.iter_text())

    assert response.status_code == 200
    assert '"type":"message_delta"' in body
    # The recall status is grounded in what retrieval actually found.
    assert ("翻到你" in body) or ("找到" in body)
    updated = client.get(f"/v1/lab/sessions/{session_id}").json()
    turn = updated["turns"][0]
    assert turn["memoryWrites"], "lab turn should expose what it remembered"
    assert turn["memoryWrites"][0]["summary"]
    assert turn["memoryWrites"][0]["type"] in {
        "episodic",
        "persona_related",
        "relationship",
        "correction",
        "reflection",
    }
