import asyncio
from collections.abc import AsyncIterator
from datetime import UTC, datetime
from uuid import UUID, uuid4

from fastapi import FastAPI, HTTPException
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
    SocialMission,
    SocialMissionResult,
)
from reso_agent.lab import LabWorkspace
from reso_agent.models.provider import ModelProviderError
from reso_agent.models.router import model_provider_for, model_route_from_env
from reso_agent.runtime.pipeline import AgentRuntime

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
lab = LabWorkspace(model_provider=_model_provider)
_stream_event_adapter: TypeAdapter[AgentStreamEvent] = TypeAdapter(AgentStreamEvent)


@app.get("/v1/health")
async def health() -> dict[str, str]:
    return {"service": "reso-agent", "status": "ok"}


@app.post("/v1/agent/turn", response_model=AgentTurnResponse, response_model_by_alias=True)
async def turn(request: AgentTurnRequest) -> AgentTurnResponse:
    response, _trace = await runtime.turn(request)
    return response


@app.post(
    "/v1/agent/reflect",
    response_model=AgentReflectionResponse,
    response_model_by_alias=True,
)
async def reflect(_request: AgentReflectionRequest) -> AgentReflectionResponse:
    return AgentReflectionResponse(memory_candidates=[], persona_patch_candidates=[])


@app.post("/v1/persona/initialize", response_model=PersonaVersion, response_model_by_alias=True)
async def initialize_persona(request: PersonaInitializeRequest) -> PersonaVersion:
    return PersonaVersion(
        id=uuid4(),
        profile_id=request.user_id,
        version=1,
        content=PersonaContent(
            uncertain_hypotheses=["Journey draft requires explicit user confirmation."]
        ),
        change_summary="Initialized from Journey answers",
        confirmed_by_user=False,
        created_at=datetime.now(UTC),
    )


@app.post(
    "/v1/persona/suggest-patch",
    response_model=AgentReflectionResponse,
    response_model_by_alias=True,
)
async def suggest_patch(_request: AgentReflectionRequest) -> AgentReflectionResponse:
    return AgentReflectionResponse(memory_candidates=[], persona_patch_candidates=[])


@app.post("/v1/social/act", response_model=SocialMissionResult, response_model_by_alias=True)
async def social_act(request: SocialMission) -> SocialMissionResult:
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
async def social_evaluate(request: SocialMissionResult) -> SocialMissionResult:
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
