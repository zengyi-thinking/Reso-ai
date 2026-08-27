import {
  CandidateDecisionRequestSchema,
  EmailSendCodeRequestSchema,
  EmailVerifyCodeRequestSchema,
  PersonaDraftUpdateRequestSchema,
  ProductConversationDetailSchema,
  ProductConversationSchema,
  ProductIdentitySchema,
  ProductTurnCompleteSchema,
  ProductTurnRequestSchema,
  QuickStartClaimAgentRequestSchema,
  QuickStartSubmitRequestSchema,
} from "@reso/contracts";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { EmailAuthService } from "../auth/email-auth-service.js";
import { ProductError } from "../product/product-error.js";
import type { GrowthCandidatesService } from "./growth-candidates-service.js";
import type { OnboardingService } from "./onboarding-service.js";
import type { ProductConversationService } from "./conversation-service.js";
import type { CandidateDecision } from "./repository.js";

interface RouteOptions {
  emailAuth: EmailAuthService;
  onboarding: OnboardingService;
  conversations: ProductConversationService;
  growth: GrowthCandidatesService;
  resolveUser(request: FastifyRequest): Promise<string | null>;
  traceIdFor(request: FastifyRequest): string;
}

export function registerVerticalSliceRoutes(app: FastifyInstance, options: RouteOptions): void {
  app.post("/api/onboarding/guest", async (_request, reply) =>
    reply.status(201).send(await options.onboarding.createGuest()),
  );
  app.get("/api/onboarding/guest", async (request) =>
    options.onboarding.getGuest(requireGuestToken(request)),
  );
  app.put("/api/onboarding/quick-start", async (request) => {
    const parsed = QuickStartSubmitRequestSchema.safeParse(request.body);
    if (!parsed.success)
      throw new ProductError("VALIDATION_FAILED", "Quick Start 信息不完整。", false);
    return options.onboarding.submitQuickStart(requireGuestToken(request), parsed.data.answers);
  });
  app.put("/api/onboarding/persona-draft", async (request) => {
    const parsed = PersonaDraftUpdateRequestSchema.safeParse(request.body);
    if (!parsed.success)
      throw new ProductError("VALIDATION_FAILED", "Persona Draft 内容无效。", false);
    return options.onboarding.confirmDraft(requireGuestToken(request), parsed.data.content);
  });

  app.post("/api/auth/email/send-code", async (request) => {
    const parsed = EmailSendCodeRequestSchema.safeParse(request.body);
    if (!parsed.success) throw new ProductError("VALIDATION_FAILED", "请输入有效邮箱。", false);
    return options.emailAuth.sendCode(parsed.data.email);
  });
  app.post("/api/auth/email/verify-code", async (request) => {
    const parsed = EmailVerifyCodeRequestSchema.safeParse(request.body);
    if (!parsed.success) throw new ProductError("VALIDATION_FAILED", "请输入 6 位验证码。", false);
    return options.emailAuth.verifyCode(parsed.data, options.traceIdFor(request));
  });
  app.get("/api/auth/me", async (request) => {
    const userId = await requireUser(request, options);
    const identity = await options.conversations.identity(userId);
    if (identity === null) throw new ProductError("AUTH_REQUIRED", "登录状态已失效。", false);
    return ProductIdentitySchema.parse(identity);
  });
  app.post("/api/agents/claim", async (request) => {
    const parsed = QuickStartClaimAgentRequestSchema.safeParse(request.body);
    if (!parsed.success) throw new ProductError("VALIDATION_FAILED", "领取信息无效。", false);
    const userId = await requireUser(request, options);
    const identity = await options.onboarding.claim(
      parsed.data.guestToken,
      userId,
      parsed.data.agentName,
    );
    // Best-effort semantic seeds for freshly promoted correction memories.
    await options.growth.backfillEmbeddingsSafely(userId);
    return ProductIdentitySchema.parse(identity);
  });

  app.get("/api/memory-candidates", async (request) => ({
    candidates: await options.growth.listMemoryCandidates(await requireUser(request, options)),
  }));
  app.post<{ Params: { id: string } }>("/api/memory-candidates/:id/decision", async (request) => {
    const decision = requireDecision(request);
    const userId = await requireUser(request, options);
    const result = await options.growth.decideMemory(userId, request.params.id, decision);
    return decisionResponse(result);
  });

  app.get("/api/persona-patches", async (request) => ({
    patches: await options.growth.listPersonaPatches(await requireUser(request, options)),
  }));
  app.post<{ Params: { id: string } }>("/api/persona-patches/:id/decision", async (request) => {
    const decision = requireDecision(request);
    const userId = await requireUser(request, options);
    const result = await options.growth.decidePersonaPatch(userId, request.params.id, decision);
    return decisionResponse(result);
  });

  app.post("/api/conversations", async (request, reply) => {
    const conversation = await options.conversations.create(await requireUser(request, options));
    return reply.status(201).send(ProductConversationSchema.parse(conversation));
  });
  app.get("/api/conversations", async (request) => ({
    conversations: await options.conversations.list(await requireUser(request, options)),
  }));
  app.get<{ Params: { id: string } }>("/api/conversations/:id", async (request) =>
    ProductConversationDetailSchema.parse(
      await options.conversations.get(await requireUser(request, options), request.params.id),
    ),
  );
  app.post<{ Params: { id: string } }>(
    "/api/conversations/:id/turns/stream",
    async (request, reply) => {
      const parsed = ProductTurnRequestSchema.safeParse(request.body);
      if (!parsed.success) throw new ProductError("VALIDATION_FAILED", "消息内容无效。", false);
      const userId = await requireUser(request, options);
      const traceId = options.traceIdFor(request);
      reply.hijack();
      reply.raw.writeHead(200, {
        "content-type": "text/event-stream; charset=utf-8",
        "cache-control": "no-cache, no-transform",
        connection: "keep-alive",
        "x-accel-buffering": "no",
        "x-trace-id": traceId,
      });
      try {
        const result = await options.conversations.turn(
          {
            userId,
            conversationId: request.params.id,
            ...parsed.data,
          },
          (event) => writeEvent(reply.raw, event),
        );
        for (const event of result.remainingEvents) writeEvent(reply.raw, event);
        writeEvent(
          reply.raw,
          ProductTurnCompleteSchema.parse({
            type: "done",
            userMessageId: result.userMessage.id,
            agentMessageId: result.agentMessage.id,
            traceId: result.traceId,
          }),
        );
      } catch (error) {
        const product =
          error instanceof ProductError
            ? error
            : new ProductError("AGENT_UNAVAILABLE", "Reso 暂时没有回应，请稍后重试。", true);
        writeEvent(reply.raw, {
          type: "error",
          code: product.code,
          text: product.message,
          retryable: product.retryable,
        });
      } finally {
        reply.raw.end();
      }
    },
  );
}

function requireDecision(request: FastifyRequest): CandidateDecision {
  const parsed = CandidateDecisionRequestSchema.safeParse(request.body);
  if (!parsed.success) throw new ProductError("VALIDATION_FAILED", "无效的确认操作。", false);
  return parsed.data.decision;
}
function decisionResponse(result: { outcome: string; memoryId?: string }): {
  outcome: string;
  memoryId: string | null;
} {
  if (result.outcome === "missing")
    throw new ProductError("CANDIDATE_NOT_FOUND", "没有找到这条候选。", false);
  if (result.outcome === "not-pending")
    throw new ProductError("CANDIDATE_ALREADY_DECIDED", "这条候选已经处理过了。", false);
  return { outcome: result.outcome, memoryId: result.memoryId ?? null };
}
async function requireUser(request: FastifyRequest, options: RouteOptions): Promise<string> {
  const userId = await options.resolveUser(request);
  if (userId === null) throw new ProductError("AUTH_REQUIRED", "请先完成邮箱验证。", false);
  return userId;
}
function requireGuestToken(request: FastifyRequest): string {
  const value = request.headers["x-guest-token"];
  if (typeof value !== "string" || value.length < 32)
    throw new ProductError("GUEST_SESSION_NOT_FOUND", "这段认识旅程已经失效。", false);
  return value;
}
function writeEvent(stream: NodeJS.WritableStream, event: unknown): void {
  stream.write(`data: ${JSON.stringify(event)}\n\n`);
}
