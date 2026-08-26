import { createAgentTurnRequest } from "@reso/test-fixtures";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ResoAgentClient } from "../src/agent-client/reso-agent-client.js";

const validResponse = {
  requestId: "0198d4f3-2f34-7c52-95cc-7ff4f6f93a12",
  message: "我会先听你说。",
  mode: "companion",
  memoryCandidates: [],
  personaPatchCandidates: [],
  relationshipCandidates: [],
  cadence: "direct",
  publicEvents: [{ type: "message", position: "final", text: "我会先听你说。" }],
  traceId: "0198d4f3-6f1e-72b4-8bc9-3af746768b00",
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("ResoAgentClient", () => {
  it("validates a successful provider response against the shared Contract", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify(validResponse), { status: 200 })),
    );

    await expect(
      new ResoAgentClient("http://agent.test").turn(createAgentTurnRequest()),
    ).resolves.toEqual(validResponse);
  });

  it("rejects an undocumented successful payload", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ message: "missing contract fields" }), { status: 200 }),
      ),
    );

    await expect(
      new ResoAgentClient("http://agent.test").turn(createAgentTurnRequest()),
    ).rejects.toThrow();
  });

  it("parses the shared error envelope without falling back to Mock", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              error: { code: "agent_unavailable", message: "Agent Service is unavailable." },
            }),
            { status: 503 },
          ),
      ),
    );

    const promise = new ResoAgentClient("http://agent.test").turn(createAgentTurnRequest());
    await expect(promise).rejects.toMatchObject({
      code: "agent_unavailable",
      status: 503,
    });
  });
});
