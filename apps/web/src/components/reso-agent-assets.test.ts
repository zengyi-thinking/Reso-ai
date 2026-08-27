import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { resoAgentAssets } from "./reso-agent-assets.js";

describe("Reso Agent asset manifest", () => {
  it("keeps all five product poses stable and available", () => {
    expect(Object.keys(resoAgentAssets)).toEqual([
      "welcome",
      "birth",
      "companion",
      "memory",
      "guardian",
    ]);
    for (const asset of Object.values(resoAgentAssets)) {
      const file = fileURLToPath(new URL(`../../public${asset}`, import.meta.url));
      expect(asset.endsWith(".webp")).toBe(true);
      expect(existsSync(file), `${asset} should exist`).toBe(true);
    }
  });
});
