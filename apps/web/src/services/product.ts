import {
  AgentPublicEventSchema,
  EmailSendCodeResponseSchema,
  EmailVerifyCodeResponseSchema,
  GuestOnboardingSchema,
  GuestOnboardingSessionSchema,
  ProductConversationDetailSchema,
  ProductConversationSchema,
  ProductIdentitySchema,
  type AgentPublicEvent,
  type PersonaContent,
  type PublicProcessMode,
  type QuickStartAnswers,
} from "@reso/contracts";

const SESSION_KEY = "reso.session.v1";
const GUEST_KEY = "reso.guest.v1";

export const productSession = {
  token: () => localStorage.getItem(SESSION_KEY),
  guestToken: () => localStorage.getItem(GUEST_KEY),
  setToken: (value: string) => localStorage.setItem(SESSION_KEY, value),
  setGuestToken: (value: string) => localStorage.setItem(GUEST_KEY, value),
  clearToken: () => localStorage.removeItem(SESSION_KEY),
};

async function request(path: string, init: RequestInit = {}): Promise<unknown> {
  const headers = new Headers(init.headers);
  if (init.body !== undefined) headers.set("content-type", "application/json");
  const token = productSession.token();
  if (token !== null) headers.set("authorization", `Bearer ${token}`);
  const response = await fetch(path, { ...init, headers });
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { message?: string } | null;
    throw new Error(body?.message ?? "Reso 暂时没有接住这次请求，请稍后再试。");
  }
  return response.status === 204 ? null : response.json();
}

function guestHeaders(): HeadersInit {
  const token = productSession.guestToken();
  if (token === null) throw new Error("这段认识旅程已经失效，请重新开始。");
  return { "x-guest-token": token };
}

export async function ensureGuest() {
  const existing = productSession.guestToken();
  if (existing !== null) {
    try {
      return GuestOnboardingSchema.parse(
        await request("/api/onboarding/guest", { headers: guestHeaders() }),
      );
    } catch {
      localStorage.removeItem(GUEST_KEY);
    }
  }
  const created = GuestOnboardingSessionSchema.parse(
    await request("/api/onboarding/guest", { method: "POST" }),
  );
  productSession.setGuestToken(created.guestToken);
  return created.onboarding;
}

export async function submitQuickStart(answers: QuickStartAnswers) {
  return GuestOnboardingSchema.parse(
    await request("/api/onboarding/quick-start", {
      method: "PUT",
      headers: guestHeaders(),
      body: JSON.stringify({ answers }),
    }),
  );
}
export async function loadGuest() {
  return GuestOnboardingSchema.parse(
    await request("/api/onboarding/guest", { headers: guestHeaders() }),
  );
}
export async function confirmPersona(content: PersonaContent) {
  return GuestOnboardingSchema.parse(
    await request("/api/onboarding/persona-draft", {
      method: "PUT",
      headers: guestHeaders(),
      body: JSON.stringify({ content }),
    }),
  );
}
export async function sendEmailCode(email: string) {
  return EmailSendCodeResponseSchema.parse(
    await request("/api/auth/email/send-code", { method: "POST", body: JSON.stringify({ email }) }),
  );
}
export async function verifyEmailCode(email: string, code: string) {
  const result = EmailVerifyCodeResponseSchema.parse(
    await request("/api/auth/email/verify-code", {
      method: "POST",
      body: JSON.stringify({ email, code, guestToken: productSession.guestToken() ?? undefined }),
    }),
  );
  productSession.setToken(result.sessionToken);
  return result;
}
export async function claimAgent(agentName = "Reso") {
  return ProductIdentitySchema.parse(
    await request("/api/agents/claim", {
      method: "POST",
      body: JSON.stringify({ guestToken: productSession.guestToken(), agentName }),
    }),
  );
}
export async function loadIdentity() {
  return ProductIdentitySchema.parse(await request("/api/auth/me"));
}
export async function createConversation() {
  return ProductConversationSchema.parse(await request("/api/conversations", { method: "POST" }));
}
export async function loadConversation(id: string) {
  return ProductConversationDetailSchema.parse(await request(`/api/conversations/${id}`));
}

export async function streamTurn(
  conversationId: string,
  message: string,
  clientMessageId: string,
  onEvent: (
    event:
      | AgentPublicEvent
      | { type: "done"; agentMessageId: string }
      | { type: "error"; text: string; retryable: boolean },
  ) => void | Promise<void>,
  publicProcessMode: PublicProcessMode = "adaptive",
): Promise<void> {
  const response = await fetch(`/api/conversations/${conversationId}/turns/stream`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${productSession.token() ?? ""}`,
    },
    body: JSON.stringify({ message, clientMessageId, publicProcessMode }),
  });
  if (!response.ok || response.body === null) throw new Error("Reso 暂时没有回应，请稍后重试。");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { done, value } = await reader.read();
    buffer += decoder.decode(value, { stream: !done });
    const chunks = buffer.split("\n\n");
    buffer = chunks.pop() ?? "";
    for (const chunk of chunks) {
      const line = chunk.split("\n").find((item) => item.startsWith("data: "));
      if (line === undefined) continue;
      const payload: unknown = JSON.parse(line.slice(6));
      const visible = AgentPublicEventSchema.safeParse(payload);
      if (visible.success) await onEvent(visible.data);
      else if (typeof payload === "object" && payload !== null && "type" in payload) {
        if (
          payload.type === "done" &&
          "agentMessageId" in payload &&
          typeof payload.agentMessageId === "string"
        )
          await onEvent({ type: "done", agentMessageId: payload.agentMessageId });
        if (payload.type === "error" && "text" in payload && typeof payload.text === "string")
          await onEvent({
            type: "error",
            text: payload.text,
            retryable: "retryable" in payload && payload.retryable === true,
          });
      }
    }
    if (done) break;
  }
}
