import {
  ClaimAgentRequestSchema,
  ClaimAgentResponseSchema,
  ClaimJourneyOwnershipRequestSchema,
  CreateJourneyRequestSchema,
  CreateJourneyResponseSchema,
  JourneyAnswerInputSchema,
  JourneyAnswerSchema,
  JourneyAttemptSchema,
  JourneyProgressSchema,
  PersonalManualEditRequestSchema,
  PersonalManualSnapshotSchema,
  RetryPersonalManualRequestSchema,
} from "@reso/contracts";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { ProductError } from "../product/product-error.js";
import type { JourneyActor } from "./journey-service.js";
import type { JourneyService } from "./journey-service.js";

export type SessionUserResolver = (request: FastifyRequest) => Promise<string | null>;

export interface JourneyRoutesOptions {
  journeyService: JourneyService;
  sessionUserResolver?: SessionUserResolver;
  traceIdFor(request: FastifyRequest): string;
}

export function registerJourneyRoutes(app: FastifyInstance, options: JourneyRoutesOptions): void {
  const { journeyService, sessionUserResolver, traceIdFor } = options;

  app.post("/api/journeys", async (request, reply) => {
    const parsed = CreateJourneyRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      throw new ProductError("VALIDATION_FAILED", "Invalid Journey create request", false);
    }
    const actor = await journeyActor(request, sessionUserResolver);
    const attempt = await journeyService.create(parsed.data, actor);
    return reply.status(201).send(CreateJourneyResponseSchema.parse({ attempt }));
  });

  app.get<{ Params: { id: string } }>("/api/journeys/:id", async (request, reply) => {
    const actor = await journeyActor(request, sessionUserResolver);
    return reply.send(
      JourneyProgressSchema.parse(await journeyService.getProgress(request.params.id, actor)),
    );
  });

  app.post<{ Params: { id: string } }>("/api/journeys/:id/answers", async (request, reply) => {
    const parsed = JourneyAnswerInputSchema.safeParse(request.body);
    if (!parsed.success) {
      throw new ProductError("VALIDATION_FAILED", "Invalid Journey answer", false);
    }
    const actor = await journeyActor(request, sessionUserResolver);
    const answer = await journeyService.answer(request.params.id, parsed.data, actor);
    return reply.status(201).send(JourneyAnswerSchema.parse(answer));
  });

  app.post<{ Params: { id: string } }>("/api/journeys/:id/complete", async (request, reply) => {
    const actor = await journeyActor(request, sessionUserResolver);
    const result = await journeyService.complete(request.params.id, actor, traceIdFor(request));
    return reply.send({
      attempt: JourneyAttemptSchema.parse(result.attempt),
      personalManual: PersonalManualSnapshotSchema.parse(result.personalManual),
    });
  });

  app.post<{ Params: { id: string } }>(
    "/api/journeys/:id/claim-ownership",
    async (request, reply) => {
      const parsed = ClaimJourneyOwnershipRequestSchema.safeParse(request.body);
      if (!parsed.success) {
        throw new ProductError("VALIDATION_FAILED", "Invalid Journey ownership claim", false);
      }
      const actor = await journeyActor(request, sessionUserResolver);
      return reply.send(
        JourneyAttemptSchema.parse(
          await journeyService.claimOwnership(
            request.params.id,
            parsed.data,
            actor,
            traceIdFor(request),
          ),
        ),
      );
    },
  );

  app.get<{ Params: { id: string } }>(
    "/api/journeys/:id/personal-manual/status",
    async (request, reply) => {
      const actor = await journeyActor(request, sessionUserResolver);
      return reply.send(
        PersonalManualSnapshotSchema.parse(
          await journeyService.getPersonalManualStatus(request.params.id, actor),
        ),
      );
    },
  );

  app.get<{ Params: { id: string } }>(
    "/api/journeys/:id/personal-manual",
    async (request, reply) => {
      const actor = await journeyActor(request, sessionUserResolver);
      return reply.send(
        PersonalManualSnapshotSchema.parse(
          await journeyService.getReadyPersonalManual(request.params.id, actor),
        ),
      );
    },
  );

  app.post<{ Params: { id: string } }>(
    "/api/journeys/:id/personal-manual/retry",
    async (request, reply) => {
      const parsed = RetryPersonalManualRequestSchema.safeParse(request.body);
      if (!parsed.success) {
        throw new ProductError("VALIDATION_FAILED", "Invalid Personal Manual retry", false);
      }
      const actor = await journeyActor(request, sessionUserResolver);
      return reply.send(
        PersonalManualSnapshotSchema.parse(
          await journeyService.retryPersonalManual(
            request.params.id,
            parsed.data,
            actor,
            traceIdFor(request),
          ),
        ),
      );
    },
  );

  app.patch<{ Params: { id: string } }>(
    "/api/journeys/:id/personal-manual",
    async (request, reply) => {
      const parsed = PersonalManualEditRequestSchema.safeParse(request.body);
      if (!parsed.success) {
        throw new ProductError("VALIDATION_FAILED", "Invalid Personal Manual edit", false);
      }
      const actor = await journeyActor(request, sessionUserResolver);
      return reply.send(
        PersonalManualSnapshotSchema.parse(
          await journeyService.editPersonalManual(
            request.params.id,
            parsed.data,
            actor,
            traceIdFor(request),
          ),
        ),
      );
    },
  );

  app.post<{ Params: { id: string } }>("/api/journeys/:id/claim-agent", async (request, reply) => {
    const parsed = ClaimAgentRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      throw new ProductError("VALIDATION_FAILED", "Invalid Agent claim", false);
    }
    const actor = await journeyActor(request, sessionUserResolver);
    return reply.send(
      ClaimAgentResponseSchema.parse(
        await journeyService.claimAgent(request.params.id, parsed.data, actor, traceIdFor(request)),
      ),
    );
  });
}

async function journeyActor(
  request: FastifyRequest,
  resolver: SessionUserResolver | undefined,
): Promise<JourneyActor> {
  const token = request.headers["x-journey-token"];
  return {
    userId: resolver === undefined ? null : await resolver(request),
    anonymousAccessToken: typeof token === "string" ? token : null,
  };
}
