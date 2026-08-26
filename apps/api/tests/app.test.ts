import { createAgentTurnRequest } from "@reso/test-fixtures";
import { afterEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { MockAgentClient } from "../src/agent-client/mock-agent-client.js";
import { buildApp } from "../src/app.js";

let app: FastifyInstance | undefined;

afterEach(async () => {
  await app?.close();
  app = undefined;
});

describe("Reso Product API", () => {
  it("reports health", async () => {
    app = await buildApp({ agentClient: new MockAgentClient() });
    const response = await app.inject({ method: "GET", url: "/v1/health" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ service: "reso-api", status: "ok" });
  });

  it("uses the same AgentTurn contract for the mock provider", async () => {
    app = await buildApp({ agentClient: new MockAgentClient() });
    const response = await app.inject({
      method: "POST",
      url: "/v1/agent/turn",
      payload: createAgentTurnRequest(),
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ mode: "companion" });
    expect(response.json().memoryCandidates).toHaveLength(1);
  });

  it("rejects undocumented request shapes", async () => {
    app = await buildApp({ agentClient: new MockAgentClient() });
    const response = await app.inject({
      method: "POST",
      url: "/v1/agent/turn",
      payload: { message: "missing identity fields" },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ error: "invalid_request" });
  });
});
