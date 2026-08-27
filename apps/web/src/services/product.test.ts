import { beforeEach, describe, expect, it, vi } from "vitest";
import { productSession, streamTurn } from "./product.js";

const values = new Map<string, string>();
beforeEach(() => {
  values.clear();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  });
});

describe("Product Agent event stream", () => {
  it("preserves status, public reflection, message and done order", async () => {
    productSession.setToken("session-token");
    const body = [
      { type: "status", phase: "recalling", text: "想起了一件和你有关的事…" },
      {
        type: "public_reflection",
        text: "你刚刚确认过，你更喜欢有内容的交流。",
        evidenceRefs: ["persona:0"],
      },
      { type: "message", position: "final", text: "这只是我现在的理解，我们还会慢慢认识。" },
      {
        type: "done",
        userMessageId: crypto.randomUUID(),
        agentMessageId: crypto.randomUUID(),
        traceId: crypto.randomUUID(),
      },
    ]
      .map((event) => `data: ${JSON.stringify(event)}\n\n`)
      .join("");
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } }),
      ),
    );
    const events: string[] = [];
    await streamTurn(crypto.randomUUID(), "你了解我吗？", "client-1", (event) => {
      events.push(event.type);
    });
    expect(events).toEqual(["status", "public_reflection", "message", "done"]);
  });
});
