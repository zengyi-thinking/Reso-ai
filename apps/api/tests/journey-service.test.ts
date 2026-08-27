import { randomUUID } from "node:crypto";
import type {
  CreateJourneyRequest,
  PersonalManualCandidate,
  PersonalManualGenerationRequest,
} from "@reso/contracts";
import { describe, expect, it } from "vitest";
import { InMemoryJourneyRepository } from "../src/journeys/in-memory-journey-repository.js";
import { JourneyService, type JourneyActor } from "../src/journeys/journey-service.js";
import { PersonalManualGenerationService } from "../src/journeys/personal-manual-generation-service.js";
import { TestAgentClient } from "./test-agent-client.js";

const userId = "0198d4f3-2f34-7c52-95cc-7ff4f6f93a12";
const otherUserId = "0198d4f3-2f34-7c52-95cc-7ff4f6f93a13";
const traceId = "0198d4f3-6f1e-72b4-8bc9-3af746768b00";
const anonymousToken = "a".repeat(43);
const anonymousActor: JourneyActor = { userId: null, anonymousAccessToken: anonymousToken };
const userActor: JourneyActor = { userId, anonymousAccessToken: null };

const choices = [
  ["invitation", "planned"],
  ["fatigue", "empathize"],
  ["slip", "support"],
  ["storm-thought", "protect"],
  ["cave-repair", "hug"],
  ["home-message", "secure"],
  ["city-realization", "build"],
] satisfies ReadonlyArray<readonly [string, string]>;

async function createJourney(
  service: JourneyService,
  actor: JourneyActor = anonymousActor,
  replayOfJourneyId?: string,
) {
  return service.create(
    {
      journeyVersion: "mountain-v1",
      clientAttemptId: randomUUID(),
      ...(replayOfJourneyId === undefined ? {} : { replayOfJourneyId }),
      ...(actor.userId === null ? { anonymousAccessToken: anonymousToken } : {}),
    },
    actor,
  );
}

async function answerAll(
  service: JourneyService,
  journeyId: string,
  actor: JourneyActor = anonymousActor,
) {
  for (const [questionId, choiceId] of choices) {
    await service.answer(
      journeyId,
      {
        stageId: questionId,
        questionId,
        choiceId,
        elapsedMs: 1_000,
        clientAnswerId: randomUUID(),
      },
      actor,
    );
  }
}

describe("Journey Backend closed loop", () => {
  it("creates, restores, and idempotently records trusted Evidence", async () => {
    const repository = new InMemoryJourneyRepository();
    const service = new JourneyService(repository);
    const clientAttemptId = randomUUID();
    const request: CreateJourneyRequest = {
      journeyVersion: "mountain-v1",
      clientAttemptId,
      anonymousAccessToken: anonymousToken,
    };
    const first = await service.create(request, anonymousActor);
    const repeated = await service.create(request, anonymousActor);
    expect(repeated.id).toBe(first.id);

    const input = {
      stageId: "fatigue",
      questionId: "fatigue",
      choiceId: "empathize",
      elapsedMs: 900,
      clientAnswerId: randomUUID(),
    };
    const answer = await service.answer(first.id, input, anonymousActor);
    const duplicate = await service.answer(first.id, input, anonymousActor);
    expect(duplicate.id).toBe(answer.id);
    expect(answer.evidence.summary).toContain("承认感受");
    expect(answer.evidence.signals).toEqual(
      expect.arrayContaining([expect.objectContaining({ dimension: "emotionalSupport" })]),
    );
    expect((await service.getProgress(first.id, anonymousActor)).attempt.answerCount).toBe(1);
  });

  it("rejects unknown definitions and preserves free answers as low-weight Evidence", async () => {
    const service = new JourneyService(new InMemoryJourneyRepository());
    const journey = await createJourney(service);
    await expect(
      service.answer(
        journey.id,
        {
          stageId: "fatigue",
          questionId: "fatigue",
          choiceId: "not-a-choice",
          clientAnswerId: randomUUID(),
        },
        anonymousActor,
      ),
    ).rejects.toMatchObject({ code: "JOURNEY_INVALID_DEFINITION" });
    const free = await service.answer(
      journey.id,
      {
        stageId: "fatigue",
        questionId: "fatigue",
        choiceId: "free-response",
        responseText: "我会先停下来问对方此刻需要什么。",
        clientAnswerId: randomUUID(),
      },
      anonymousActor,
    );
    expect(free.evidence.responseText).toContain("停下来");
    expect(free.evidence.signals).toEqual([
      { dimension: "freeResponse", value: "user-authored", weight: 1 },
    ]);
  });

  it("serializes concurrent answers for one question and rejects conflicting content", async () => {
    const service = new JourneyService(new InMemoryJourneyRepository());
    const journey = await createJourney(service);
    const first = service.answer(
      journey.id,
      {
        stageId: "slip",
        questionId: "slip",
        choiceId: "support",
        clientAnswerId: randomUUID(),
      },
      anonymousActor,
    );
    const second = service.answer(
      journey.id,
      {
        stageId: "slip",
        questionId: "slip",
        choiceId: "command",
        clientAnswerId: randomUUID(),
      },
      anonymousActor,
    );
    const results = await Promise.allSettled([first, second]);
    expect(results.filter(({ status }) => status === "fulfilled")).toHaveLength(1);
    expect(results.filter(({ status }) => status === "rejected")).toHaveLength(1);
    expect((await service.getProgress(journey.id, anonymousActor)).answers).toHaveLength(1);
  });

  it("completes transactionally and remains idempotent; incomplete completion emits no event", async () => {
    const repository = new InMemoryJourneyRepository();
    const service = new JourneyService(repository);
    const incomplete = await createJourney(service);
    await expect(service.complete(incomplete.id, anonymousActor, traceId)).rejects.toMatchObject({
      code: "JOURNEY_INCOMPLETE",
    });
    expect(repository.listOutboxEvents()).toHaveLength(0);

    const complete = await createJourney(service);
    await answerAll(service, complete.id);
    const first = await service.complete(complete.id, anonymousActor, traceId);
    const repeated = await service.complete(complete.id, anonymousActor, traceId);
    expect(repeated.personalManual.id).toBe(first.personalManual.id);
    expect(first.personalManual.status).toBe("generating");
    expect(repository.listOutboxEvents()).toHaveLength(1);
    await expect(
      service.answer(
        complete.id,
        {
          stageId: "fatigue",
          questionId: "fatigue",
          choiceId: "solve",
          clientAnswerId: randomUUID(),
        },
        anonymousActor,
      ),
    ).rejects.toMatchObject({ code: "JOURNEY_ALREADY_COMPLETED" });
  });

  it("keeps first official Evidence immutable when a completed Journey is replayed", async () => {
    const repository = new InMemoryJourneyRepository();
    const service = new JourneyService(repository);
    const first = await createJourney(service);
    await answerAll(service, first.id);
    await service.complete(first.id, anonymousActor, traceId);
    const original = await repository.getJourneyEvidenceSnapshot(first.id);

    const replay = await createJourney(service, anonymousActor, first.id);
    await answerAll(service, replay.id);
    await service.complete(replay.id, anonymousActor, traceId);
    expect(replay.official).toBe(false);
    expect((await repository.getJourneyEvidenceSnapshot(replay.id))?.official).toBe(false);
    expect(await repository.getJourneyEvidenceSnapshot(first.id)).toEqual(original);
  });

  it("automatically treats later attempts as replay even when the client omits replayOfJourneyId", async () => {
    const repository = new InMemoryJourneyRepository();
    const service = new JourneyService(repository);
    const first = await createJourney(service, userActor);
    const second = await createJourney(service, userActor);
    expect(first.official).toBe(true);
    expect(second.official).toBe(false);
    expect(second.replayOfJourneyId).toBe(first.id);
  });

  it("fails closed on resource ownership and securely claims an anonymous Journey", async () => {
    const repository = new InMemoryJourneyRepository();
    const service = new JourneyService(repository);
    const journey = await createJourney(service);
    await expect(
      service.getProgress(journey.id, { userId: null, anonymousAccessToken: "b".repeat(43) }),
    ).rejects.toMatchObject({ code: "JOURNEY_FORBIDDEN" });
    const claimed = await service.claimOwnership(
      journey.id,
      { clientClaimId: randomUUID() },
      { userId, anonymousAccessToken: anonymousToken },
      traceId,
    );
    expect(claimed.userId).toBe(userId);
    await expect(
      service.getProgress(journey.id, { userId: otherUserId, anonymousAccessToken: null }),
    ).rejects.toMatchObject({ code: "JOURNEY_FORBIDDEN" });
  });

  it("downgrades claimed anonymous Evidence to replay when the user already has official Evidence", async () => {
    const repository = new InMemoryJourneyRepository();
    const service = new JourneyService(repository);
    const existing = await createJourney(service, userActor);
    await answerAll(service, existing.id, userActor);
    await service.complete(existing.id, userActor, traceId);

    const anonymous = await createJourney(service, anonymousActor);
    await answerAll(service, anonymous.id, anonymousActor);
    await service.complete(anonymous.id, anonymousActor, traceId);
    const claimed = await service.claimOwnership(
      anonymous.id,
      { clientClaimId: randomUUID() },
      { userId, anonymousAccessToken: anonymousToken },
      traceId,
    );
    expect(claimed).toMatchObject({
      official: false,
      replayOfJourneyId: existing.id,
    });
    expect((await repository.getJourneyEvidenceSnapshot(existing.id))?.official).toBe(true);
    expect((await repository.getJourneyEvidenceSnapshot(anonymous.id))?.official).toBe(false);
  });

  it("moves generating to ready and exposes the Manual without an edit/confirm gate", async () => {
    const repository = new InMemoryJourneyRepository();
    const service = new JourneyService(repository);
    const journey = await createJourney(service);
    await answerAll(service, journey.id);
    await service.complete(journey.id, anonymousActor, traceId);
    await new PersonalManualGenerationService(repository, new TestAgentClient()).generate(
      journey.id,
      traceId,
    );
    const ready = await service.getReadyPersonalManual(journey.id, anonymousActor);
    expect(ready.status).toBe("ready");
    expect(ready.currentContent?.variables).toHaveLength(9);
    expect(ready.currentContent?.sections).toHaveLength(5);
    await expect(
      service.getReadyPersonalManual(journey.id, {
        userId: otherUserId,
        anonymousAccessToken: null,
      }),
    ).rejects.toMatchObject({ code: "JOURNEY_FORBIDDEN" });
  });

  it("persists a retryable failure without displaying a fixed success template", async () => {
    const repository = new InMemoryJourneyRepository();
    const service = new JourneyService(repository);
    const journey = await createJourney(service);
    await answerAll(service, journey.id);
    await service.complete(journey.id, anonymousActor, traceId);
    await expect(
      new PersonalManualGenerationService(repository, new TestAgentClient("timeout")).generate(
        journey.id,
        traceId,
      ),
    ).rejects.toMatchObject({ code: "AGENT_TIMEOUT" });
    const failed = await service.getPersonalManualStatus(journey.id, anonymousActor);
    expect(failed).toMatchObject({ status: "failed", retryable: true, errorCode: "AGENT_TIMEOUT" });
    expect(failed.currentContent).toBeNull();
    await expect(service.getReadyPersonalManual(journey.id, anonymousActor)).rejects.toMatchObject({
      code: "PERSONAL_MANUAL_NOT_READY",
    });
    const retryRequest = { clientRetryId: randomUUID() };
    const retrying = await service.retryPersonalManual(
      journey.id,
      retryRequest,
      anonymousActor,
      traceId,
    );
    const repeatedRetry = await service.retryPersonalManual(
      journey.id,
      retryRequest,
      anonymousActor,
      traceId,
    );
    expect(retrying.status).toBe("generating");
    expect(repeatedRetry.status).toBe("generating");
    expect(repository.listOutboxEvents()).toHaveLength(2);
    await repository.failPersonalManual({
      journeyId: journey.id,
      errorCode: "AGENT_TIMEOUT",
      retryable: true,
    });
    const staleReplay = await service.retryPersonalManual(
      journey.id,
      retryRequest,
      anonymousActor,
      traceId,
    );
    expect(staleReplay.status).toBe("failed");
    const freshRetry = await service.retryPersonalManual(
      journey.id,
      { clientRetryId: randomUUID() },
      anonymousActor,
      traceId,
    );
    expect(freshRetry.status).toBe("generating");
    expect(repository.listOutboxEvents()).toHaveLength(3);
  });

  it("rejects nonexistent Evidence references and never persists an invalid candidate", async () => {
    class InvalidReferenceAgent extends TestAgentClient {
      override async generatePersonalManual(
        request: PersonalManualGenerationRequest,
      ): Promise<PersonalManualCandidate> {
        const candidate = await super.generatePersonalManual(request);
        return {
          ...candidate,
          variables: candidate.variables.map((variable, index) =>
            index === 0 ? { ...variable, evidenceRefs: ["unknown/evidence"] } : variable,
          ),
        };
      }
    }
    const repository = new InMemoryJourneyRepository();
    const service = new JourneyService(repository);
    const journey = await createJourney(service);
    await answerAll(service, journey.id);
    await service.complete(journey.id, anonymousActor, traceId);
    await expect(
      new PersonalManualGenerationService(repository, new InvalidReferenceAgent()).generate(
        journey.id,
        traceId,
      ),
    ).rejects.toMatchObject({ code: "AGENT_INVALID_RESPONSE" });
    expect(await service.getPersonalManualStatus(journey.id, anonymousActor)).toMatchObject({
      status: "failed",
      currentContent: null,
      retryable: false,
    });
  });

  it("supports optional edits without changing Evidence, then claims one Persona V1 and Agent", async () => {
    const repository = new InMemoryJourneyRepository();
    const service = new JourneyService(repository);
    const journey = await createJourney(service, userActor);
    await answerAll(service, journey.id, userActor);
    await service.complete(journey.id, userActor, traceId);
    await new PersonalManualGenerationService(repository, new TestAgentClient()).generate(
      journey.id,
      traceId,
    );
    const evidenceBefore = await repository.getJourneyEvidenceSnapshot(journey.id);
    const ready = await service.getReadyPersonalManual(journey.id, userActor);
    if (ready.currentContent === null) throw new Error("Expected ready Personal Manual content");
    const editedContent = {
      ...ready.currentContent,
      variables: ready.currentContent.variables.map((variable, index) =>
        index === 0 ? { ...variable, name: "我修改后的行动起点" } : variable,
      ),
    };
    const edited = await service.editPersonalManual(
      journey.id,
      { clientEditId: randomUUID(), expectedRevision: 1, content: editedContent },
      userActor,
      traceId,
    );
    expect(edited.currentSource).toBe("user_edit");
    expect(edited.originalContent?.variables[0]?.name).not.toBe("我修改后的行动起点");
    expect(await repository.getJourneyEvidenceSnapshot(journey.id)).toEqual(evidenceBefore);

    const claimRequest = { clientClaimId: randomUUID() };
    const firstClaim = await service.claimAgent(journey.id, claimRequest, userActor, traceId);
    const repeated = await service.claimAgent(journey.id, claimRequest, userActor, traceId);
    expect(repeated.agent.id).toBe(firstClaim.agent.id);
    expect(repeated.personaVersion.id).toBe(firstClaim.personaVersion.id);
    expect(firstClaim.personaVersion.version).toBe(1);
    expect(firstClaim.personaVersion.confirmedByUser).toBe(true);
    expect(JSON.stringify(firstClaim.personaVersion.content)).toContain("我修改后的行动起点");
    expect(
      repository.listOutboxEvents().filter(({ eventType }) => eventType === "persona.created"),
    ).toHaveLength(1);
  });

  it("claims a ready unedited Manual without requiring a separate confirmation step", async () => {
    const repository = new InMemoryJourneyRepository();
    const service = new JourneyService(repository);
    const journey = await createJourney(service, userActor);
    await answerAll(service, journey.id, userActor);
    await service.complete(journey.id, userActor, traceId);
    await new PersonalManualGenerationService(repository, new TestAgentClient()).generate(
      journey.id,
      traceId,
    );
    const claimed = await service.claimAgent(
      journey.id,
      { clientClaimId: randomUUID() },
      userActor,
      traceId,
    );
    expect(claimed.personalManual.status).toBe("claimed");
    expect(claimed.agent.name).toBe("Reso Agent");
  });
});
