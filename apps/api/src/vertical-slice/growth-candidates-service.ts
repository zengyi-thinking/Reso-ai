import type { MemoryCandidateRecord, PersonaPatchRecord } from "@reso/contracts";
import type { AgentClientError, IAgentClient } from "../agent-client/agent-client.js";
import type { CandidateDecision, DecideResult, VerticalSliceRepository } from "./repository.js";

const EMBED_BACKFILL_LIMIT = 8;

/**
 * User-facing candidate review surface: pending memory candidates and persona
 * patch candidates, plus the accept/reject decisions that drive promotion.
 *
 * Promotion inserts an accepted memories row immediately; semantic embedding is
 * a best-effort enhancement afterwards - if the embedding backend is down the
 * row stays usable through the lexical baseline and is retried by the next
 * backfill pass. This degradation is deliberate and documented in ADR-0008.
 */
export class GrowthCandidatesService {
  constructor(
    private readonly repository: VerticalSliceRepository,
    private readonly agentClient: IAgentClient,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async listMemoryCandidates(userId: string): Promise<MemoryCandidateRecord[]> {
    return this.repository.listPendingMemoryCandidates(userId);
  }

  async listPersonaPatches(userId: string): Promise<PersonaPatchRecord[]> {
    return this.repository.listPendingPersonaPatches(userId);
  }

  async decideMemory(
    userId: string,
    candidateId: string,
    decision: CandidateDecision,
  ): Promise<DecideResult> {
    const result = await this.repository.decideMemoryCandidate(
      candidateId,
      userId,
      decision,
      this.now().toISOString(),
    );
    if (result.outcome === "promoted" && result.memoryId !== undefined && result.summary) {
      await this.embedPromotedMemorySafely(result.memoryId, result.summary);
    }
    return result;
  }

  async decidePersonaPatch(
    userId: string,
    candidateId: string,
    decision: CandidateDecision,
  ): Promise<DecideResult> {
    return this.repository.decidePersonaPatch(
      candidateId,
      userId,
      decision,
      this.now().toISOString(),
    );
  }

  /** Backfills missing embeddings for a user's accepted memories (claim time). */
  async backfillEmbeddingsSafely(userId: string): Promise<number> {
    let stored = 0;
    try {
      const targets = await this.repository.listMemoriesWithoutEmbedding(
        userId,
        EMBED_BACKFILL_LIMIT,
      );
      if (targets.length === 0) return 0;
      const response = await this.agentClient.embedTexts({
        inputs: targets.map((target) => target.summary),
      });
      for (const [index, target] of targets.entries()) {
        const embedding = response.embeddings[index];
        if (embedding === undefined) continue;
        await this.repository.storeMemoryEmbedding(target.id, embedding);
        stored += 1;
      }
    } catch (error) {
      const code = (error as AgentClientError).code ?? "UNKNOWN";
      console.warn(
        { event: "embedding-backfill-skipped", code },
        "lexical-only retrieval until retry",
      );
    }
    return stored;
  }

  /** Embeds one freshly promoted memory after accept. Never fails the decision. */
  async embedPromotedMemorySafely(memoryId: string, summary: string): Promise<void> {
    try {
      const response = await this.agentClient.embedTexts({ inputs: [summary] });
      const embedding = response.embeddings[0];
      if (embedding !== undefined) await this.repository.storeMemoryEmbedding(memoryId, embedding);
    } catch (error) {
      const code = (error as AgentClientError).code ?? "UNKNOWN";
      console.warn(
        { event: "memory-embedding-skipped", code },
        "lexical-only retrieval until retry",
      );
    }
  }
}
