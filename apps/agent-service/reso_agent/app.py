from datetime import UTC, datetime
from uuid import uuid4

from fastapi import FastAPI

from reso_agent.contracts import (
    AgentReflectionRequest,
    AgentReflectionResponse,
    AgentTurnRequest,
    AgentTurnResponse,
    PersonaContent,
    PersonaInitializeRequest,
    PersonaVersion,
    SocialMission,
    SocialMissionResult,
)
from reso_agent.runtime.pipeline import AgentRuntime

app = FastAPI(title="Reso Agent", version="0.1.0")
runtime = AgentRuntime()


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
