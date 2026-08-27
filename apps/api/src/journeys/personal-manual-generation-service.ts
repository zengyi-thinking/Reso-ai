import { PersonalManualCandidateSchema } from "@reso/contracts";
import type { IAgentClient } from "../agent-client/agent-client.js";
import { AgentClientError } from "../agent-client/agent-client.js";
import { ProductError } from "../product/product-error.js";
import type { JourneyRepository } from "./journey-repository.js";
import { validatePersonalManualCandidate } from "./manual-validation.js";

export class PersonalManualGenerationService {
  constructor(
    private readonly repository: JourneyRepository,
    private readonly agentClient: IAgentClient,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async generate(journeyId: string, traceId: string) {
    const existing = await this.repository.getPersonalManual(journeyId);
    if (existing === null) {
      throw new ProductError("PERSONAL_MANUAL_NOT_FOUND", "Personal Manual not found", false);
    }
    if (existing.status === "ready" || existing.status === "claimed") return existing;
    await this.repository.markPersonalManualGenerating(journeyId);
    const request = await this.repository.getPersonalManualGenerationRequest(journeyId, traceId);
    if (request === null) {
      await this.repository.failPersonalManual({
        journeyId,
        errorCode: "JOURNEY_EVIDENCE_MISSING",
        retryable: false,
      });
      throw new ProductError("JOURNEY_INCOMPLETE", "Journey evidence is missing", false);
    }
    try {
      const parsed = PersonalManualCandidateSchema.safeParse(
        await this.agentClient.generatePersonalManual(request),
      );
      if (!parsed.success) {
        throw new AgentClientError(
          "AGENT_INVALID_RESPONSE",
          "Agent returned an invalid Personal Manual candidate",
          false,
        );
      }
      const candidate = validatePersonalManualCandidate(parsed.data, request.evidence);
      return await this.repository.savePersonalManualCandidate({
        journeyId,
        candidate,
        generatedAt: this.now().toISOString(),
      });
    } catch (error) {
      if (error instanceof AgentClientError) {
        await this.repository.failPersonalManual({
          journeyId,
          errorCode: error.code,
          retryable: error.retryable,
        });
        throw error;
      }
      if (error instanceof ProductError) {
        await this.repository.failPersonalManual({
          journeyId,
          errorCode: "AGENT_INVALID_RESPONSE",
          retryable: false,
        });
        throw new AgentClientError(
          "AGENT_INVALID_RESPONSE",
          "Agent candidate failed Personal Manual safety validation",
          false,
        );
      }
      await this.repository.failPersonalManual({
        journeyId,
        errorCode: "AGENT_UNAVAILABLE",
        retryable: true,
      });
      throw new AgentClientError("AGENT_UNAVAILABLE", "Personal Manual generation failed", true);
    }
  }
}
