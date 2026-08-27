import { describe, expect, it } from "vitest";
import { buildProcessSteps, processSummary } from "./conversation-process.js";

describe("Reso public thinking process", () => {
  it("keeps ordered, user-visible steps separate from the final answer", () => {
    const events = [
      {
        type: "status" as const,
        phase: "composing" as const,
        step: 1,
        label: "听懂这句话",
        text: "我先看看，哪一点真的让你想靠近。",
      },
      {
        type: "public_reflection" as const,
        text: "你更看重有内容的交流。",
        evidenceRefs: ["persona:0"],
      },
      { type: "message" as const, position: "final" as const, text: "可以先从一个小问题开始。" },
    ];

    expect(buildProcessSteps(events)).toHaveLength(2);
    expect(processSummary(events)).toBe("想了 2 步");
  });

  it("names the optional deep relationship flow without pretending it completed missing steps", () => {
    const events = [
      {
        type: "status" as const,
        phase: "composing" as const,
        step: 1,
        label: "先找一个具体共鸣",
        text: "我先看看共同点。",
      },
      {
        type: "status" as const,
        phase: "composing" as const,
        step: 2,
        label: "再看看边界",
        text: "这里还缺少对方边界的信息。",
      },
    ];

    expect(processSummary(events)).toBe("深度关系思考 · 2 步");
  });
});
