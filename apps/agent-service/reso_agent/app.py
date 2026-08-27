import asyncio
import hmac
import os
from collections.abc import AsyncIterator
from datetime import UTC, datetime
from uuid import UUID, uuid4

from fastapi import Depends, FastAPI, Header, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import TypeAdapter

from reso_agent.contracts import (
    AgentMessageDeltaEvent,
    AgentMessageEvent,
    AgentReflectionRequest,
    AgentReflectionResponse,
    AgentStatusEvent,
    AgentStreamCompleteEvent,
    AgentStreamErrorEvent,
    AgentStreamEvent,
    AgentTurnRequest,
    AgentTurnResponse,
    AnalyzeIncomingRequest,
    AnalyzeIncomingResponse,
    LabMemoryUpdate,
    LabPatchDecision,
    LabSession,
    LabSessionCreateRequest,
    LabTurn,
    LabTurnRequest,
    LabUser,
    PersonaContent,
    PersonaInitializeRequest,
    PersonaVersion,
    PolishDraftRequest,
    PolishDraftResponse,
    SocialActRequestV1,
    SocialActResponseV1,
    SocialEvaluateRequestV1,
    SocialEvaluateResponseV1,
    SocialMission,
    SocialMissionResult,
)
from reso_agent.lab import LabWorkspace
from reso_agent.models.provider import ModelProviderError
from reso_agent.models.router import model_provider_for, model_route_from_env
from reso_agent.persona.draft import build_journey_draft
from reso_agent.runtime.pipeline import AgentRuntime
from reso_agent.runtime.product_tasks import ProductTaskRuntime

app = FastAPI(title="Reso Agent", version="0.1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5174", "http://127.0.0.1:5174"],
    allow_methods=["GET", "POST", "PATCH", "DELETE"],
    allow_headers=["Content-Type"],
)
# Real-model-first: production boots only with a valid MiniMax configuration.
# RESO_MODEL_ROUTE=deterministic is the explicit opt-out used by the test suite.
_model_provider = model_provider_for(model_route_from_env())
runtime = AgentRuntime(model_provider=_model_provider)
product_tasks = ProductTaskRuntime(_model_provider)
lab = LabWorkspace(model_provider=_model_provider)
_stream_event_adapter: TypeAdapter[AgentStreamEvent] = TypeAdapter(AgentStreamEvent)
_service_token = os.getenv("AGENT_SERVICE_TOKEN", "").strip()
if os.getenv("APP_ENV", "development").lower() == "production" and not _service_token:
    raise RuntimeError("Production Agent Service requires AGENT_SERVICE_TOKEN")


async def require_service_auth(authorization: str | None = Header(default=None)) -> None:
    if not _service_token:
        return
    expected = f"Bearer {_service_token}"
    if authorization is None or not hmac.compare_digest(authorization, expected):
        raise HTTPException(status_code=401, detail="Service authentication required")


@app.get("/v1/health")
async def health() -> dict[str, str]:
    return {"service": "reso-agent", "status": "ok"}


@app.post("/v1/agent/turn", response_model=AgentTurnResponse, response_model_by_alias=True)
async def turn(
    request: AgentTurnRequest, _auth: None = Depends(require_service_auth)
) -> AgentTurnResponse:
    response, _trace = await runtime.turn(request)
    return response


@app.post(
    "/v1/assist/analyze",
    response_model=AnalyzeIncomingResponse,
    response_model_by_alias=True,
)
async def analyze_incoming(
    request: AnalyzeIncomingRequest, _auth: None = Depends(require_service_auth)
) -> AnalyzeIncomingResponse:
    try:
        return await product_tasks.analyze_incoming(request)
    except ModelProviderError as error:
        raise HTTPException(status_code=502, detail="Agent Assist analysis failed") from error


@app.post(
    "/v1/assist/polish",
    response_model=PolishDraftResponse,
    response_model_by_alias=True,
)
async def polish_draft(
    request: PolishDraftRequest, _auth: None = Depends(require_service_auth)
) -> PolishDraftResponse:
    try:
        return await product_tasks.polish_draft(request)
    except ModelProviderError as error:
        raise HTTPException(status_code=502, detail="Agent Assist polish failed") from error


@app.post(
    "/v1/tea-party/act",
    response_model=SocialActResponseV1,
    response_model_by_alias=True,
)
async def tea_party_act(
    request: SocialActRequestV1, _auth: None = Depends(require_service_auth)
) -> SocialActResponseV1:
    try:
        return await product_tasks.act_socially(request)
    except ModelProviderError as error:
        raise HTTPException(status_code=502, detail="Tea Party act failed") from error


@app.post(
    "/v1/tea-party/evaluate",
    response_model=SocialEvaluateResponseV1,
    response_model_by_alias=True,
)
async def tea_party_evaluate(
    request: SocialEvaluateRequestV1, _auth: None = Depends(require_service_auth)
) -> SocialEvaluateResponseV1:
    try:
        return await product_tasks.evaluate_social(request)
    except ModelProviderError as error:
        raise HTTPException(status_code=502, detail="Tea Party evaluation failed") from error


@app.post(
    "/v1/agent/reflect",
    response_model=AgentReflectionResponse,
    response_model_by_alias=True,
)
async def reflect(
    _request: AgentReflectionRequest, _auth: None = Depends(require_service_auth)
) -> AgentReflectionResponse:
    return AgentReflectionResponse(memory_candidates=[], persona_patch_candidates=[])


@app.post("/v1/persona/initialize", response_model=PersonaVersion, response_model_by_alias=True)
async def initialize_persona(
    request: PersonaInitializeRequest, _auth: None = Depends(require_service_auth)
) -> PersonaVersion:
    if not request.answers:
        return PersonaVersion(
            id=uuid4(),
            profile_id=request.user_id,
            version=1,
            content=PersonaContent(
                uncertain_hypotheses=["Journey draft requires explicit user confirmation."]
            ),
            change_summary="Initialized without Journey answers",
            confirmed_by_user=False,
            created_at=datetime.now(UTC),
        )
    return build_journey_draft(request)


@app.post(
    "/v1/persona/suggest-patch",
    response_model=AgentReflectionResponse,
    response_model_by_alias=True,
)
async def suggest_patch(
    _request: AgentReflectionRequest, _auth: None = Depends(require_service_auth)
) -> AgentReflectionResponse:
    return AgentReflectionResponse(memory_candidates=[], persona_patch_candidates=[])


@app.post("/v1/social/act", response_model=SocialMissionResult, response_model_by_alias=True)
async def social_act(
    request: SocialMission, _auth: None = Depends(require_service_auth)
) -> SocialMissionResult:
    return SocialMissionResult(
        mission_id=request.mission_id,
        summary="Bootstrap skeleton: no external social action was executed.",
        interesting_points=[],
        shared_topics=[],
        conflicts=[],
        open_questions=[],
        recommendation_candidate=False,
        confidence=0,
        turns_used=0,
        stop_reason="bootstrap-disabled",
    )


@app.post("/v1/social/evaluate", response_model=SocialMissionResult, response_model_by_alias=True)
async def social_evaluate(
    request: SocialMissionResult, _auth: None = Depends(require_service_auth)
) -> SocialMissionResult:
    return request


@app.get("/v1/lab/users", response_model=list[LabUser], response_model_by_alias=True)
async def lab_users() -> list[LabUser]:
    return lab.users()


@app.post("/v1/lab/sessions", response_model=LabSession, response_model_by_alias=True)
async def create_lab_session(request: LabSessionCreateRequest) -> LabSession:
    try:
        return lab.create_session(request)
    except (KeyError, ValueError) as error:
        raise HTTPException(status_code=400, detail=str(error)) from error


@app.get("/v1/lab/sessions/{session_id}", response_model=LabSession, response_model_by_alias=True)
async def get_lab_session(session_id: UUID) -> LabSession:
    try:
        return lab.get_session(session_id)
    except KeyError as error:
        raise HTTPException(status_code=404, detail=str(error)) from error


@app.delete("/v1/lab/sessions/{session_id}")
async def clear_lab_session(session_id: UUID) -> dict[str, str]:
    try:
        lab.clear_session(session_id)
    except KeyError as error:
        raise HTTPException(status_code=404, detail=str(error)) from error
    return {"status": "cleared"}


@app.post(
    "/v1/lab/sessions/{session_id}/turns",
    response_model=LabTurn,
    response_model_by_alias=True,
)
async def create_lab_turn(session_id: UUID, request: LabTurnRequest) -> LabTurn:
    try:
        return await lab.run_turn(session_id, request)
    except KeyError as error:
        raise HTTPException(status_code=404, detail=str(error)) from error
    except (ValueError, ModelProviderError) as error:
        raise HTTPException(status_code=502, detail=str(error)) from error


@app.post("/v1/lab/sessions/{session_id}/turns/stream")
async def stream_lab_turn(session_id: UUID, request: LabTurnRequest) -> StreamingResponse:
    async def events() -> AsyncIterator[str]:
        progress: asyncio.Queue[AgentStatusEvent] = asyncio.Queue()
        emitted: list[str] = []
        task = asyncio.create_task(
            lab.run_turn(session_id, request, on_progress=progress.put_nowait)
        )
        try:
            while not task.done():
                try:
                    event = await asyncio.wait_for(progress.get(), timeout=0.05)
                except TimeoutError:
                    continue
                serialized = _stream_data(event)
                emitted.append(serialized)
                yield serialized
            while not progress.empty():
                event = progress.get_nowait()
                serialized = _stream_data(event)
                emitted.append(serialized)
                yield serialized
            turn = await task
            for public_event in turn.public_events:
                serialized = _stream_data(public_event)
                if serialized in emitted:
                    emitted.remove(serialized)
                    continue
                if isinstance(public_event, AgentMessageEvent):
                    for chunk in _message_chunks(public_event.text):
                        yield _stream_data(AgentMessageDeltaEvent(text=chunk))
                        await asyncio.sleep(0.03)
                yield serialized
            yield _stream_data(AgentStreamCompleteEvent(turn_id=turn.id, trace_id=turn.trace_id))
        except KeyError:
            yield _stream_data(
                AgentStreamErrorEvent(
                    code="LAB_SESSION_NOT_FOUND",
                    text="这个测试会话已经不存在，请新建 Session。",
                    retryable=False,
                )
            )
        except ModelProviderError:
            yield _stream_data(
                AgentStreamErrorEvent(
                    code="MODEL_PROVIDER_FAILED",
                    text="Reso 这次没有连接上模型。你的消息还在，可以重新发送。",
                    retryable=True,
                )
            )
        except ValueError:
            yield _stream_data(
                AgentStreamErrorEvent(
                    code="AGENT_OUTPUT_INVALID",
                    text="Reso 没能整理好这次回复，请再试一次。",
                    retryable=True,
                )
            )
        finally:
            if not task.done():
                task.cancel()

    return StreamingResponse(
        events(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


def _message_chunks(text: str, size: int = 12) -> list[str]:
    return [text[index : index + size] for index in range(0, len(text), size)]


def _stream_data(event: AgentStreamEvent) -> str:
    payload = _stream_event_adapter.dump_json(event, by_alias=True).decode("utf-8")
    return f"data: {payload}\n\n"


@app.post(
    "/v1/lab/sessions/{session_id}/simulate/{day}",
    response_model=list[LabTurn],
    response_model_by_alias=True,
)
async def simulate_lab_day(session_id: UUID, day: int) -> list[LabTurn]:
    try:
        return await lab.simulate(session_id, day)
    except KeyError as error:
        raise HTTPException(status_code=404, detail=str(error)) from error
    except (ValueError, ModelProviderError) as error:
        raise HTTPException(status_code=400, detail=str(error)) from error


@app.patch(
    "/v1/lab/sessions/{session_id}/memories/{memory_id}",
    response_model=LabSession,
    response_model_by_alias=True,
)
async def update_lab_memory(
    session_id: UUID, memory_id: UUID, update: LabMemoryUpdate
) -> LabSession:
    try:
        return lab.update_memory(session_id, memory_id, update)
    except KeyError as error:
        raise HTTPException(status_code=404, detail=str(error)) from error


@app.patch(
    "/v1/lab/sessions/{session_id}/patches/{patch_id}",
    response_model=LabSession,
    response_model_by_alias=True,
)
async def decide_lab_patch(
    session_id: UUID, patch_id: UUID, decision: LabPatchDecision
) -> LabSession:
    try:
        return lab.decide_patch(session_id, patch_id, decision)
    except KeyError as error:
        raise HTTPException(status_code=404, detail=str(error)) from error
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error
