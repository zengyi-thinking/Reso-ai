import type { SocialActRequest, SocialActResponse } from "@reso/contracts";
import { describe, expect, it } from "vitest";
import { MockAgentClient } from "../src/agent-client/mock-agent-client.js";
import {
  createDevelopmentRepository,
  demoIds,
  prepareDevelopmentDemo,
} from "../src/product/development-demo.js";

describe("development demo bootstrap", () => {
  it("keeps the Product API bootable when the Agent provider is unavailable", async () => {
    const repository = createDevelopmentRepository();

    await expect(
      prepareDevelopmentDemo(repository, new MockAgentClient("unavailable")),
    ).resolves.toBeUndefined();

    await expect(
      repository.getTeaPartyMissionByConnection(demoIds.connection),
    ).resolves.toMatchObject({
      status: "failed",
      errorCode: "AGENT_UNAVAILABLE",
    });
  });

  it("still fails fast for unexpected bootstrap defects", async () => {
    class BrokenAgentClient extends MockAgentClient {
      override async actSocially(_request: SocialActRequest): Promise<SocialActResponse> {
        throw new Error("unexpected implementation defect");
      }
    }

    await expect(
      prepareDevelopmentDemo(createDevelopmentRepository(), new BrokenAgentClient()),
    ).rejects.toThrow("unexpected implementation defect");
  });
});
