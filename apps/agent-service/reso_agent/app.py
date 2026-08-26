from datetime import UTC, datetime
from uuid import UUID, uuid4

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware

from reso_agent.contracts import (
    AgentReflectionRequest,
    AgentReflectionResponse,
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
from reso_agent.runtime.pipeline import AgentRuntime

app = FastAPI(title="Reso Agent", version="0.1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5174", "http://127.0.0.1:5174"],
    allow_methods=["GET", "POST", "PATCH", "DELETE"],
    allow_headers=["Content-Type"],
)
runtime = AgentRuntime()
lab = LabWorkspace()


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
