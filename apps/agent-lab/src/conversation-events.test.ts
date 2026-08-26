import { describe, expect, it } from "vitest";
import type { AgentPublicEvent } from "@reso/contracts";
import { eventPauseDuration, nextVisibleEvents } from "./conversation-events.js";

describe("breathing conversation event queue", () => {
  it("replaces transient status when public content arrives", () => {
    const status: AgentPublicEvent = {
      type: "status",
      phase: "recalling",
      text: "想起了一件和你有关的事…",
    };
    const reflection: AgentPublicEvent = {
      type: "public_reflection",
      text: "你之前提到过这件事。",
      evidenceRefs: ["memory:0"],
    };

    expect(nextVisibleEvents([status], reflection)).toEqual([reflection]);
  });

  it("keeps reconsideration between tentative and final messages", () => {
    const tentative: AgentPublicEvent = {
      type: "message",
      position: "tentative",
      text: "我第一反应是直接问她。",
    };
    const reconsidering: AgentPublicEvent = {
      type: "status",
      phase: "reconsidering",
      text: "等等，我再换一个角度看看。",
    };
    const final: AgentPublicEvent = {
      type: "message",
      position: "final",
      text: "现在可以先观察两次互动。",
    };

    const events = nextVisibleEvents(nextVisibleEvents([tentative], reconsidering), final);
    expect(events).toEqual([tentative, reconsidering, final]);
    expect(events.reduce((total, event) => total + eventPauseDuration(event), 0)).toBe(440);
  });
});
