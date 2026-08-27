import type {
  AnalyzeIncomingRequest,
  PolishDraftRequest,
  SocialActRequest,
  SocialEvaluateRequest,
} from "@reso/contracts";
import { createAgentTurnRequest } from "@reso/test-fixtures";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AgentClientError } from "../src/agent-client/agent-client.js";
import { TestAgentClient } from "./test-agent-client.js";
import { ResoAgentClient } from "../src/agent-client/reso-agent-client.js";

const id = "0198d4f3-2f34-7c52-95cc-7ff4f6f93a12";
const otherId = "0198d4f3-2f34-7c52-95cc-7ff4f6f93a13";

const validResponse = {
  requestId: id,
  message: "我会先听你说。",
  mode: "companion",
  memoryCandidates: [],
  personaPatchCandidates: [],
  relationshipCandidates: [],
  cadence: "direct",
  publicEvents: [{ type: "message", position: "final", text: "我会先听你说。" }],
  traceId: "0198d4f3-6f1e-72b4-8bc9-3af746768b00",
};

const analyzeRequest: AnalyzeIncomingRequest = {
  requestId: id,
  idempotencyKey: "req-1",
  requesterUserId: id,
  connectionId: id,
  sourceMessageId: id,
  sourceText: "周末有空吗？",
  senderUserId: otherId,
  agentId: id,
  traceId: id,
};
const polishRequest: PolishDraftRequest = {
  requestId: id,
  idempotencyKey: "req-2",
  requesterUserId: id,
  connectionId: id,
  draft: "你怎么不回我",
  replyToMessageId: null,
  agentId: id,
  traceId: id,
};
const socialRequest: SocialActRequest = {
  missionId: id,
  connectionId: id,
  turnNo: 1,
  speakerAgentId: id,
  listenerAgentId: otherId,
  priorMessages: [],
  disclosureLevel: "L2_SOCIAL",
  maxContentLength: 2_000,
  idempotencyKey: "mission-1:turn-1",
  traceId: id,
};
const evaluateRequest: SocialEvaluateRequest = {
  missionId: id,
  messages: [
    { id, turnNo: 1, speakerAgentId: id, content: "内容", createdAt: "2026-08-26T08:00:00+08:00" },
  ],
  traceId: id,
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

  it("parses the shared error envelope without provider fallback", async () => {
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
      code: "AGENT_UNAVAILABLE",
      status: 503,
    });
  });

  it("returns deterministic test-fixture results for the same idempotency key", async () => {
    const client = new TestAgentClient();
    const first = await client.analyzeIncoming(analyzeRequest);
    const second = await client.analyzeIncoming(analyzeRequest);
    expect(first).toEqual(second);
    expect((await client.polishDraft(polishRequest)).candidates).toHaveLength(1);
    expect((await client.actSocially(socialRequest)).speakerAgentId).toBe(id);
  });

  it.each(["timeout", "unavailable", "invalid_schema"] as const)(
    "supports the %s failure drill",
    async (mode) => {
      await expect(
        new TestAgentClient(mode).analyzeIncoming(analyzeRequest),
      ).rejects.toBeInstanceOf(AgentClientError);
    },
  );

  it("validates remote responses with the same contract and sends service auth", async () => {
    const calls: Array<{ url: string; authorization: string | null }> = [];
    const fetchImplementation: typeof fetch = async (input, init) => {
      const url = String(input);
      calls.push({ url, authorization: new Headers(init?.headers).get("authorization") });
      if (url.endsWith("/v1/assist/analyze")) {
        return Response.json({ interpretation: "解释", replyRoutes: [], traceId: id });
      }
      if (url.endsWith("/v1/assist/polish")) {
        return Response.json({ candidates: [{ id: "one", text: "候选" }], traceId: id });
      }
      if (url.endsWith("/v1/tea-party/act")) {
        return Response.json({
          speakerAgentId: id,
          content: "受控内容",
          disclosure: { decision: "ALLOW", level: "L2_SOCIAL", reasonCode: "allowed" },
          shouldStop: false,
          stopReason: null,
          traceId: id,
          agentVersionId: null,
        });
      }
      return Response.json({
        summary: { headline: "标题", conversationStarter: "开场" },
        traceId: id,
      });
    };
    const client = new ResoAgentClient({
      baseUrl: "http://agent.test/",
      serviceToken: "secret",
      fetchImplementation,
    });

    expect((await client.analyzeIncoming(analyzeRequest)).traceId).toBe(id);
    expect((await client.polishDraft(polishRequest)).traceId).toBe(id);
    expect((await client.actSocially(socialRequest)).traceId).toBe(id);
    expect((await client.evaluateSocial(evaluateRequest)).traceId).toBe(id);
    expect(calls.every((call) => call.authorization === "Bearer secret")).toBe(true);
  });

  it("rejects an invalid remote response before business persistence", async () => {
    const client = new ResoAgentClient({
      baseUrl: "http://agent.test",
      fetchImplementation: async () => Response.json({ unexpected: true }),
    });
    await expect(client.analyzeIncoming(analyzeRequest)).rejects.toMatchObject({
      code: "AGENT_INVALID_RESPONSE",
    });
  });

  it("classifies malformed remote JSON as an invalid response", async () => {
    const client = new ResoAgentClient({
      baseUrl: "http://agent.test",
      fetchImplementation: async () => new Response("not-json", { status: 200 }),
    });
    await expect(client.analyzeIncoming(analyzeRequest)).rejects.toMatchObject({
      code: "AGENT_INVALID_RESPONSE",
      retryable: false,
    });
  });
});
