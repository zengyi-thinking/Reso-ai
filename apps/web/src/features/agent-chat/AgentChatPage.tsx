import { useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import type { AgentPublicEvent, ProductMessage, PublicProcessMode } from "@reso/contracts";
import { loadConversation, streamTurn } from "../../services/product.js";
import { buildProcessSteps, processSummary } from "./conversation-process.js";

type LiveItem = AgentPublicEvent & { key: string };
export function AgentChatPage(): React.JSX.Element {
  const { conversationId = "" } = useParams();
  const [messages, setMessages] = useState<ProductMessage[]>([]);
  const [live, setLive] = useState<LiveItem[]>([]);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [deepProcess, setDeepProcess] = useState(false);
  const threadRef = useRef<HTMLDivElement>(null);
  const lastSubmission = useRef<{ message: string; id: string } | null>(null);
  async function restore() {
    if (!conversationId) return;
    const detail = await loadConversation(conversationId);
    setMessages(detail.messages);
  }
  useEffect(() => {
    void restore().catch((reason: Error) => setError(reason.message));
  }, [conversationId]);
  useEffect(() => {
    const thread = threadRef.current;
    if (thread !== null) thread.scrollTop = thread.scrollHeight;
  }, [messages, live]);
  async function submit(message: string = draft, clientMessageId: string = crypto.randomUUID()) {
    const clean = message.trim();
    if (!clean || sending || !conversationId) return;
    setSending(true);
    setError("");
    setDraft("");
    setLive([]);
    lastSubmission.current = { message: clean, id: clientMessageId };
    setMessages((current) => [
      ...current,
      {
        id: clientMessageId,
        conversationId,
        role: "user",
        content: clean,
        publicEvents: [],
        createdAt: new Date().toISOString(),
      },
    ]);
    try {
      const mode: PublicProcessMode = deepProcess ? "relationship_deep_dive" : "adaptive";
      let motionBudget = window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 900;
      await streamTurn(
        conversationId,
        clean,
        clientMessageId,
        async (event) => {
          if (event.type === "error") {
            setError(event.text);
            return;
          }
          if (event.type === "done") return;
          setLive((current) => {
            const serialized = JSON.stringify(event);
            if (current.some((item) => JSON.stringify({ ...item, key: undefined }) === serialized))
              return current;
            return [...current, { ...event, key: crypto.randomUUID() }];
          });
          const targetDelay = event.type === "status" ? (deepProcess ? 180 : 300) : 360;
          const delay = Math.min(targetDelay, motionBudget);
          motionBudget -= delay;
          if (delay > 0) await new Promise((resolve) => window.setTimeout(resolve, delay));
        },
        mode,
      );
      await restore();
      setLive([]);
      lastSubmission.current = null;
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "发送失败");
    } finally {
      setSending(false);
    }
  }
  function onKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      void submit();
    }
  }
  return (
    <section className="chat-page">
      <header className="chat-header">
        <div className="mini-avatar">R</div>
        <div>
          <strong>Reso</strong>
          <span>{sending ? "正在跟着你继续想…" : "在这里"}</span>
        </div>
      </header>
      <div className="chat-thread" aria-live="polite" ref={threadRef}>
        {messages.map((message, index) =>
          message.role === "user" ? (
            <div className="chat-row chat-row--user" key={message.id}>
              <div className="message-bubble message-bubble--user">{message.content}</div>
            </div>
          ) : (
            <AgentTurnEvents
              defaultExpanded={index === messages.length - 1}
              events={message.publicEvents}
              fallback={message.content}
              key={message.id}
            />
          ),
        )}
        {live.length > 0 && <AgentTurnEvents events={live} live />}
        {sending && live.length === 0 && (
          <div className="thinking-pill">
            <span />
            我先跟着你的话想一想…
          </div>
        )}
        {error && (
          <div className="inline-error">
            <span>{error}</span>
            {lastSubmission.current && (
              <button
                onClick={() => {
                  const last = lastSubmission.current!;
                  setMessages((items) => items.filter((item) => item.id !== last.id));
                  void submit(last.message, last.id);
                }}
              >
                重新发送
              </button>
            )}
          </div>
        )}
      </div>
      <div className="composer">
        <label className={`deep-process-toggle${deepProcess ? " is-active" : ""}`}>
          <input
            checked={deepProcess}
            disabled={sending}
            onChange={(event) => setDeepProcess(event.target.checked)}
            type="checkbox"
          />
          <span>深度关系思考</span>
          <small>可选 · 4 步</small>
        </label>
        <textarea
          aria-label="给 Reso 发消息"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={onKeyDown}
          placeholder="和 Reso 说点什么…"
          rows={1}
        />
        <button aria-label="发送" disabled={sending || !draft.trim()} onClick={() => void submit()}>
          ↑
        </button>
        <small>Enter 发送 · Shift + Enter 换行</small>
      </div>
    </section>
  );
}

function AgentTurnEvents({
  events,
  fallback,
  live = false,
  defaultExpanded = false,
}: {
  events: AgentPublicEvent[];
  fallback?: string;
  live?: boolean;
  defaultExpanded?: boolean;
}) {
  const process = buildProcessSteps(events);
  const answers = events.filter(
    (event): event is Extract<AgentPublicEvent, { type: "message" }> =>
      event.type === "message" && event.position === "final",
  );
  return (
    <div className={`chat-turn${live ? " is-live" : ""}`}>
      {process.length > 0 && (
        <ThinkingProcess
          defaultExpanded={defaultExpanded}
          events={events}
          live={live}
          steps={process}
        />
      )}
      {answers.map((event, index) => (
        <PublicEvent event={event} key={`answer-${index}`} />
      ))}
      {answers.length === 0 && fallback !== undefined && (
        <PublicEvent event={{ type: "message", position: "final", text: fallback }} />
      )}
    </div>
  );
}

function ThinkingProcess({
  events,
  steps,
  live,
  defaultExpanded,
}: {
  events: AgentPublicEvent[];
  steps: ReturnType<typeof buildProcessSteps>;
  live: boolean;
  defaultExpanded: boolean;
}) {
  const body = (
    <ol className="process-steps">
      {steps.map((event, index) => (
        <li className={`process-step process-step--${event.type}`} key={`${event.type}-${index}`}>
          <span className="process-step__marker" aria-hidden="true">
            {event.type === "status" && event.step !== undefined ? event.step : index + 1}
          </span>
          <div>
            <strong>{processLabel(event)}</strong>
            <p>{event.text}</p>
          </div>
        </li>
      ))}
    </ol>
  );
  if (live) {
    return (
      <section className="thinking-process thinking-process--live" aria-label="Reso 正在思考">
        <div className="process-summary">
          <span className="process-breath" aria-hidden="true" />
          <strong>Reso 正在想</strong>
          <small>{steps.length} 步</small>
        </div>
        {body}
      </section>
    );
  }
  return (
    <details className="thinking-process" open={defaultExpanded}>
      <summary className="process-summary">
        <span className="process-check" aria-hidden="true">
          ✓
        </span>
        <strong>思考过程</strong>
        <small>{processSummary(events)}</small>
        <span className="process-complete">已完成</span>
      </summary>
      {body}
    </details>
  );
}

function processLabel(event: ReturnType<typeof buildProcessSteps>[number]): string {
  if (event.type === "status") {
    if (event.label !== undefined) return event.label;
    return {
      understanding: "先听懂这句话",
      recalling: "想起与你有关的内容",
      noticing: "注意到一个小变化",
      composing: "把想法慢慢说清楚",
      reconsidering: "换个角度再看一次",
    }[event.phase];
  }
  if (event.type === "public_reflection") {
    return event.evidenceRefs.some((reference) => reference.startsWith("memory:"))
      ? "想起了一件事"
      : "我注意到了一点";
  }
  return "先说一个还不确定的想法";
}

function PublicEvent({ event }: { event: AgentPublicEvent }) {
  if (event.type === "status") return null;
  if (event.type === "public_reflection")
    return (
      <div className="reflection-card">
        <small>✦ 想起了一件与你有关的事</small>
        <p>{event.text}</p>
      </div>
    );
  return (
    <div className={`chat-row chat-row--agent message-${event.position}`}>
      <div className="mini-avatar mini-avatar--message">R</div>
      <div className="message-bubble message-bubble--agent">{event.text}</div>
    </div>
  );
}
