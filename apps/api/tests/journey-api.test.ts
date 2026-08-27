import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { InMemoryJourneyRepository } from "../src/journeys/in-memory-journey-repository.js";
import { TestAgentClient } from "./test-agent-client.js";

const userId = "0198d4f3-2f34-7c52-95cc-7ff4f6f93a12";
const token = "a".repeat(43);
const apps: Awaited<ReturnType<typeof buildApp>>[] = [];

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

async function createApp() {
  const app = await buildApp({
    agentClient: new TestAgentClient(),
    journeyRepository: new InMemoryJourneyRepository(),
    sessionUserResolver: async (request) =>
      request.headers.authorization === "Bearer valid-session" ? userId : null,
  });
  apps.push(app);
  return app;
}

describe("Journey Product API", () => {
  it("uses a hashed anonymous credential and never exposes its database representation", async () => {
    const app = await createApp();
    const missingCredential = await app.inject({
      method: "POST",
      url: "/api/journeys",
      payload: { journeyVersion: "mountain-v1", clientAttemptId: randomUUID() },
    });
    expect(missingCredential.statusCode).toBe(422);

    const created = await app.inject({
      method: "POST",
      url: "/api/journeys",
      payload: {
        journeyVersion: "mountain-v1",
        clientAttemptId: randomUUID(),
        anonymousAccessToken: token,
      },
    });
    expect(created.statusCode).toBe(201);
    expect(created.body).not.toContain("anonymousTokenHash");
    expect(created.body).not.toContain(token);
    const journeyId = created.json().attempt.id;

    const restored = await app.inject({
      method: "GET",
      url: `/api/journeys/${journeyId}`,
      headers: { "x-journey-token": token },
    });
    const forbidden = await app.inject({
      method: "GET",
      url: `/api/journeys/${journeyId}`,
      headers: { "x-journey-token": "b".repeat(43) },
    });
    expect(restored.statusCode).toBe(200);
    expect(forbidden.statusCode).toBe(403);
  });

  it("derives user ownership from the server Session and rejects browser conclusions", async () => {
    const app = await createApp();
    const injectedUser = await app.inject({
      method: "POST",
      url: "/api/journeys",
      headers: { authorization: "Bearer valid-session" },
      payload: {
        journeyVersion: "mountain-v1",
        clientAttemptId: randomUUID(),
        userId: "0198d4f3-2f34-7c52-95cc-7ff4f6f93a13",
      },
    });
    expect(injectedUser.statusCode).toBe(422);

    const created = await app.inject({
      method: "POST",
      url: "/api/journeys",
      headers: { authorization: "Bearer valid-session" },
      payload: { journeyVersion: "mountain-v1", clientAttemptId: randomUUID() },
    });
    expect(created.json().attempt.userId).toBe(userId);
    const answer = await app.inject({
      method: "POST",
      url: `/api/journeys/${created.json().attempt.id}/answers`,
      headers: { authorization: "Bearer valid-session" },
      payload: {
        stageId: "fatigue",
        questionId: "fatigue",
        choiceId: "empathize",
        clientAnswerId: randomUUID(),
        summary: "browser supplied conclusion",
        signals: [{ dimension: "persona", value: "fixed", weight: 3 }],
        confidence: 1,
        official: true,
      },
    });
    expect(answer.statusCode).toBe(422);
  });

  it("never echoes a private free response in a public validation error", async () => {
    const app = await createApp();
    const created = await app.inject({
      method: "POST",
      url: "/api/journeys",
      payload: {
        journeyVersion: "mountain-v1",
        clientAttemptId: randomUUID(),
        anonymousAccessToken: token,
      },
    });
    const privateResponse = "这是只供说明书综合的私人自由回答";
    const invalid = await app.inject({
      method: "POST",
      url: `/api/journeys/${created.json().attempt.id}/answers`,
      headers: { "x-journey-token": token },
      payload: {
        stageId: "unknown-stage",
        questionId: "unknown-stage",
        choiceId: "free-response",
        responseText: privateResponse,
        clientAnswerId: randomUUID(),
      },
    });
    expect(invalid.statusCode).toBe(422);
    expect(invalid.body).not.toContain(privateResponse);
  });
});
