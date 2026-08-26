import { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  AgentStreamEventSchema,
  type AgentPublicEvent,
  type AgentStreamEvent,
  type LabSession,
  type LabTurn,
  type LabUser,
  type MemoryContext,
  type PersonaPatchCandidate,
} from "@reso/contracts";
import "@reso/design-tokens/tokens.css";
import { eventPauseDuration, nextVisibleEvents } from "./conversation-events.js";
import "./style.css";

const apiBase = import.meta.env.VITE_AGENT_SERVICE_URL ?? "http://localhost:8000";
const defaultProvider =
  import.meta.env.VITE_DEFAULT_MODEL_PROVIDER === "real" ? "real" : "deterministic";

type Panel = "inspector" | "persona" | "memory";
type Operation = "idle" | "session" | "simulate" | "inspector";
type PendingTurn = {
  message: string;
  replayTurnId?: string;
  events: AgentPublicEvent[];
  error: string | null;
  retryable: boolean;
};

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${apiBase}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => ({ detail: response.statusText }))) as {
      detail?: string;
    };
    throw new Error(body.detail ?? `HTTP ${response.status}`);
  }
  return (await response.json()) as T;
}

async function streamTurn(
  sessionId: string,
  payload: { message: string; replayTurnId?: string },
  onEvent: (event: AgentStreamEvent) => Promise<void>,
): Promise<string> {
  const response = await fetch(`${apiBase}/v1/lab/sessions/${sessionId}/turns/stream`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
    body: JSON.stringify(payload),
  });
  if (!response.ok || !response.body) throw new Error(`HTTP ${response.status}`);

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let completedTurnId = "";
  while (true) {
    const { done, value } = await reader.read();
    buffer += decoder.decode(value, { stream: !done });
    const frames = buffer.split("\n\n");
    buffer = frames.pop() ?? "";
    for (const frame of frames) {
      const data = frame
        .split("\n")
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).trim())
        .join("\n");
      if (!data) continue;
      const event = AgentStreamEventSchema.parse(JSON.parse(data) as unknown);
      await onEvent(event);
      if (event.type === "complete") completedTurnId = event.turnId;
      if (event.type === "error") throw new StreamError(event.text, event.retryable);
    }
    if (done) break;
  }
  if (!completedTurnId) throw new Error("回复流意外结束，请重新发送。");
  return completedTurnId;
}

class StreamError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
  ) {
    super(message);
  }
}

function AgentLab(): React.JSX.Element {
  const [users, setUsers] = useState<LabUser[]>([]);
  const [provider, setProvider] = useState<"deterministic" | "real">(defaultProvider);
  const [session, setSession] = useState<LabSession | null>(null);
  const [selectedTurnId, setSelectedTurnId] = useState<string | null>(null);
  const [panel, setPanel] = useState<Panel>("inspector");
  const [message, setMessage] = useState("");
  const [operation, setOperation] = useState<Operation>("idle");
  const [pending, setPending] = useState<PendingTurn | null>(null);
  const [error, setError] = useState<string | null>(null);

  const selectedTurn = useMemo(
    () => session?.turns.find((turn) => turn.id === selectedTurnId) ?? session?.turns.at(-1),
    [selectedTurnId, session],
  );

  useEffect(() => {
    void api<LabUser[]>("/v1/lab/users")
      .then(setUsers)
      .catch((reason: unknown) => setError(errorText(reason)));
  }, []);

  async function run<T>(kind: Exclude<Operation, "idle">, action: () => Promise<T>): Promise<T> {
    setOperation(kind);
    setError(null);
    try {
      return await action();
    } catch (reason: unknown) {
      setError(errorText(reason));
      throw reason;
    } finally {
      setOperation("idle");
    }
  }

  async function startSession(): Promise<void> {
    const user = users[0];
    if (!user) return;
    await run("session", async () => {
      const created = await api<LabSession>("/v1/lab/sessions", {
        method: "POST",
        body: JSON.stringify({ userSlug: user.slug, provider }),
      });
      setSession(created);
      setSelectedTurnId(null);
      setPending(null);
    }).catch(() => undefined);
  }

  async function refresh(sessionId = session?.id): Promise<LabSession | null> {
    if (!sessionId) return null;
    const updated = await api<LabSession>(`/v1/lab/sessions/${sessionId}`);
    setSession(updated);
    return updated;
  }

  async function submit(
    text: string,
    replayTurnId?: string,
    replacePending = false,
  ): Promise<void> {
    if (!session || (pending && !replacePending) || !text.trim()) return;
    const snapshot = text.trim();
    setMessage("");
    setError(null);
    setPending({
      message: snapshot,
      ...(replayTurnId ? { replayTurnId } : {}),
      events: [],
      error: null,
      retryable: false,
    });
    try {
      const turnId = await streamTurn(
        session.id,
        { message: snapshot, ...(replayTurnId ? { replayTurnId } : {}) },
        async (event) => {
          if (event.type === "complete" || event.type === "error") return;
          setPending((current) =>
            current ? { ...current, events: nextVisibleEvents(current.events, event) } : current,
          );
          await eventPause(event);
        },
      );
      await refresh(session.id);
      setSelectedTurnId(turnId);
      setPending(null);
    } catch (reason: unknown) {
      setPending((current) =>
        current
          ? {
              ...current,
              error: errorText(reason),
              retryable: reason instanceof StreamError ? reason.retryable : true,
            }
          : current,
      );
    }
  }

  async function simulate(day: 1 | 7 | 30): Promise<void> {
    if (!session || pending) return;
    await run("simulate", async () => {
      const turns = await api<LabTurn[]>(`/v1/lab/sessions/${session.id}/simulate/${day}`, {
        method: "POST",
      });
      await refresh();
      setSelectedTurnId(turns.at(-1)?.id ?? null);
    }).catch(() => undefined);
  }

  async function clear(): Promise<void> {
    if (!session || pending) return;
    await run("session", async () => {
      await api(`/v1/lab/sessions/${session.id}`, { method: "DELETE" });
      setSession(null);
      setSelectedTurnId(null);
    }).catch(() => undefined);
  }

  const operationBusy = operation !== "idle";
  return (
    <main>
      <header className="topbar">
        <div className="brand-block">
          <span className="brand-mark" aria-hidden="true" />
          <div>
            <p className="eyebrow">Synthetic workspace</p>
            <h1>Reso Agent Lab</h1>
            <p className="lead">不是等待生成，而是看见 Reso 怎样继续理解一个人。</p>
          </div>
        </div>
        <div className="session-controls">
          <label>
            测试用户
            <select disabled value={users[0]?.slug ?? "loading"}>
              <option>{users[0]?.displayName ?? "加载中…"}</option>
            </select>
          </label>
          <label>
            模型路线
            <select
              value={provider}
              onChange={(event) => setProvider(event.target.value as "deterministic" | "real")}
            >
              <option value="deterministic">Deterministic · CI</option>
              <option value="real">MiniMax · Real</option>
            </select>
          </label>
          <button
            disabled={operationBusy || pending !== null || users.length === 0}
            onClick={() => void startSession()}
          >
            新 Session
          </button>
          <button
            className="quiet-button"
            disabled={!session || operationBusy || pending !== null}
            onClick={() => void clear()}
          >
            清空
          </button>
        </div>
      </header>

      {error ? (
        <p className="global-error" role="alert">
          {error}
        </p>
      ) : null}
      {!session ? (
        <section className="empty-state">
          <span className="empty-orbit" aria-hidden="true" />
          <p className="eyebrow">A conversation that remembers</p>
          <h2>从 Alice 的 Personal Manual v1.0 开始</h2>
          <p>新建 Session 后，可以连续聊天，并观察 Memory、Persona 与公开反思如何一起工作。</p>
          <button
            disabled={operationBusy || users.length === 0}
            onClick={() => void startSession()}
          >
            开始一段对话
          </button>
        </section>
      ) : (
        <>
          <nav className="timeline" aria-label="Longitudinal simulation">
            <span>Longitudinal simulation</span>
            {([1, 7, 30] as const).map((day) => (
              <button
                key={day}
                disabled={operationBusy || pending !== null}
                onClick={() => void simulate(day)}
              >
                Day {day}
              </button>
            ))}
            <strong>{session.persona.version}</strong>
          </nav>
          <section className="workspace">
            <Conversation
              message={message}
              onMessage={setMessage}
              onReplay={() => selectedTurn && void submit(selectedTurn.input, selectedTurn.id)}
              onRetry={() => pending && void submit(pending.message, pending.replayTurnId, true)}
              onSelect={setSelectedTurnId}
              onSend={() => void submit(message)}
              pending={pending}
              selectedTurnId={selectedTurn?.id ?? null}
              turns={session.turns}
            />
            <aside className="inspector">
              <div className="tabs">
                {(["inspector", "persona", "memory"] as const).map((name) => (
                  <button
                    className={panel === name ? "active" : ""}
                    key={name}
                    onClick={() => setPanel(name)}
                  >
                    {name === "inspector"
                      ? "Turn Inspector"
                      : name === "persona"
                        ? "Persona"
                        : "Memory"}
                  </button>
                ))}
              </div>
              {panel === "inspector" ? <TurnInspector turn={selectedTurn} /> : null}
              {panel === "persona" ? (
                <PersonaPanel
                  patches={session.pendingPatches}
                  persona={session.persona}
                  onDecision={(patch, decision, proposedValue) =>
                    void run("inspector", async () => {
                      await api(`/v1/lab/sessions/${session.id}/patches/${patch.id}`, {
                        method: "PATCH",
                        body: JSON.stringify({ decision, proposedValue }),
                      });
                      await refresh();
                    }).catch(() => undefined)
                  }
                />
              ) : null}
              {panel === "memory" ? (
                <MemoryPanel
                  memories={session.memories}
                  onToggle={(memory) =>
                    void run("inspector", async () => {
                      await api(`/v1/lab/sessions/${session.id}/memories/${memory.id}`, {
                        method: "PATCH",
                        body: JSON.stringify({ enabled: !memory.enabled }),
                      });
                      await refresh();
                    }).catch(() => undefined)
                  }
                />
              ) : null}
            </aside>
          </section>
        </>
      )}
    </main>
  );
}

function Conversation(props: {
  turns: LabTurn[];
  selectedTurnId: string | null;
  message: string;
  pending: PendingTurn | null;
  onSelect: (id: string) => void;
  onMessage: (value: string) => void;
  onSend: () => void;
  onReplay: () => void;
  onRetry: () => void;
}): React.JSX.Element {
  const messagesRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const node = messagesRef.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [props.pending, props.turns.length]);

  return (
    <section className="conversation">
      <div className="section-title">
        <div>
          <span>和 Reso 聊聊</span>
          <small>
            {props.turns.length} turns · {props.pending ? "回应中" : "可以继续"}
          </small>
        </div>
        <button
          className="quiet-button"
          disabled={!props.selectedTurnId || props.pending !== null}
          onClick={props.onReplay}
        >
          Replay
        </button>
      </div>
      <div className="messages" ref={messagesRef} aria-live="polite">
        {props.turns.length === 0 && !props.pending ? (
          <div className="conversation-empty">
            <span className="reso-presence" aria-hidden="true" />
            <p>我在。你想从最近发生的哪一小段开始？</p>
          </div>
        ) : null}
        {props.turns.map((turn) => (
          <TurnView
            key={turn.id}
            selected={props.selectedTurnId === turn.id}
            turn={turn}
            onSelect={props.onSelect}
          />
        ))}
        {props.pending ? <PendingTurnView pending={props.pending} onRetry={props.onRetry} /> : null}
      </div>
      <div className="composer-wrap">
        <div className="composer">
          <textarea
            aria-label="发消息给 Reso"
            placeholder={props.pending ? "你可以先写下一条…" : "和 Reso 说点什么…"}
            value={props.message}
            onChange={(event) => props.onMessage(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                event.preventDefault();
                props.onSend();
              }
            }}
          />
          <button
            aria-label="发送消息"
            disabled={props.pending !== null || !props.message.trim()}
            onClick={props.onSend}
          >
            发送
          </button>
        </div>
        <small>Enter 发送 · Shift + Enter 换行</small>
      </div>
    </section>
  );
}

function TurnView(props: {
  turn: LabTurn;
  selected: boolean;
  onSelect: (id: string) => void;
}): React.JSX.Element {
  return (
    <article className={`turn-block ${props.selected ? "selected" : ""}`}>
      <div className="user-row">
        <div className="user-bubble">{props.turn.input}</div>
      </div>
      <div className="agent-row">
        <span className="reso-avatar" aria-hidden="true">
          <i />
        </span>
        <div className="agent-sequence">
          {props.turn.publicEvents.map((event, index) => (
            <PublicEventView completed event={event} key={`${event.type}-${index}`} />
          ))}
          <button className="turn-meta" onClick={() => props.onSelect(props.turn.id)}>
            {props.turn.cadence} · {props.turn.mode} · {props.turn.model.provider} ·{" "}
            {props.turn.model.latencyMs}ms
          </button>
        </div>
      </div>
    </article>
  );
}

function PendingTurnView({
  pending,
  onRetry,
}: {
  pending: PendingTurn;
  onRetry: () => void;
}): React.JSX.Element {
  return (
    <article className="turn-block pending-turn">
      <div className="user-row">
        <div className="user-bubble">{pending.message}</div>
      </div>
      <div className="agent-row">
        <span className="reso-avatar breathing" aria-hidden="true">
          <i />
        </span>
        <div className="agent-sequence">
          {pending.events.length === 0 && !pending.error ? (
            <PublicEventView
              event={{ type: "status", phase: "understanding", text: "正在想想这件事…" }}
            />
          ) : null}
          {pending.events.map((event, index) => (
            <PublicEventView event={event} key={`${event.type}-${index}`} />
          ))}
          {pending.error ? (
            <div className="turn-error" role="alert">
              <p>{pending.error}</p>
              {pending.retryable ? <button onClick={onRetry}>重新发送</button> : null}
            </div>
          ) : null}
        </div>
      </div>
    </article>
  );
}

function PublicEventView({
  event,
  completed = false,
}: {
  event: AgentPublicEvent;
  completed?: boolean;
}): React.JSX.Element | null {
  if (event.type === "status") {
    if (completed && event.phase !== "reconsidering") return null;
    return (
      <div className={`thinking-status ${event.phase}`}>
        <span aria-hidden="true" />
        {event.text}
      </div>
    );
  }
  if (event.type === "public_reflection") {
    const memory = event.evidenceRefs.some((reference) => reference.startsWith("memory:"));
    return (
      <div className="reflection-card">
        <small>{memory ? "想起了一件事" : "我注意到了一点"}</small>
        <p>{event.text}</p>
      </div>
    );
  }
  return <div className={`agent-bubble ${event.position}`}>{event.text}</div>;
}

function TurnInspector({ turn }: { turn: LabTurn | undefined }): React.JSX.Element {
  if (!turn) return <p className="muted panel-copy">点击一轮对话，查看它使用了哪些公开依据。</p>;
  return (
    <div className="panel-scroll">
      <Inspect title="Breathing output">
        <Code value={{ cadence: turn.cadence, events: turn.publicEvents }} />
      </Inspect>
      <Inspect title="Input">
        <p>{turn.input}</p>
      </Inspect>
      <Inspect title="Persona">
        <Code value={{ version: turn.personaVersion, fields: turn.personaFields }} />
      </Inspect>
      <Inspect title="Retrieved memories">
        {turn.retrievedMemories.length === 0 ? (
          <p className="muted">本轮没有相关 Recall。</p>
        ) : (
          turn.retrievedMemories.map((item) => (
            <div className="memory-score" key={item.memory.id}>
              <strong>
                {item.memory.type} · {item.score.final.toFixed(2)}
              </strong>
              <p>{item.memory.summary}</p>
              <small>{item.score.reason}</small>
            </div>
          ))
        )}
      </Inspect>
      <Inspect title="Mode">
        <p>{turn.mode}</p>
        <small>{turn.modeReason}</small>
      </Inspect>
      <Inspect title="Context">
        <Code value={turn.contextSummary} />
      </Inspect>
      <Inspect title="Model">
        <Code value={turn.model} />
      </Inspect>
      <Inspect title="Post-turn">
        <Code
          value={{
            memoryCandidateIds: turn.memoryCandidateIds,
            personaPatchCandidates: turn.personaPatchCandidates,
            relationshipCandidates: turn.relationshipCandidates,
          }}
        />
      </Inspect>
      <Inspect title="Eval">
        {turn.eval.map((check) => (
          <p className={check.passed ? "pass" : "fail"} key={check.id}>
            {check.passed ? "✓" : "✕"} {check.id} — {check.detail}
          </p>
        ))}
      </Inspect>
      <Inspect title="Trace">
        <Code
          value={{
            traceId: turn.traceId,
            promptVersion: turn.promptVersion,
            replayOf: turn.replayOf,
          }}
        />
        <small>Allowlist only · no Chain-of-Thought · no raw provider payload</small>
      </Inspect>
    </div>
  );
}

function PersonaPanel(props: {
  persona: LabSession["persona"];
  patches: PersonaPatchCandidate[];
  onDecision: (
    patch: PersonaPatchCandidate,
    decision: "accept" | "reject" | "edit",
    proposedValue?: unknown,
  ) => void;
}): React.JSX.Element {
  return (
    <div className="panel-scroll">
      <Inspect title={`Personal Manual ${props.persona.version}`}>
        <Code value={props.persona.content} />
      </Inspect>
      <Inspect title="Pending patch">
        {props.patches.length === 0 ? (
          <p className="muted">还没有 Patch。明确纠正会产生一个可审查候选。</p>
        ) : (
          props.patches.map((patch) => (
            <div className="patch-card" key={patch.id}>
              <strong>
                {patch.path} · {Math.round(patch.confidence * 100)}%
              </strong>
              <p>{String(patch.proposedValue)}</p>
              <small>{patch.reason}</small>
              <div className="actions">
                <button
                  disabled={patch.status !== "pending"}
                  onClick={() => props.onDecision(patch, "accept")}
                >
                  Accept
                </button>
                <button
                  className="quiet-button"
                  disabled={patch.status !== "pending"}
                  onClick={() => props.onDecision(patch, "reject")}
                >
                  Reject
                </button>
                <button
                  className="quiet-button"
                  disabled={patch.status !== "pending"}
                  onClick={() => {
                    const edited = window.prompt(
                      "编辑 Preview（仅 Lab）",
                      String(patch.proposedValue),
                    );
                    if (edited !== null) props.onDecision(patch, "edit", edited);
                  }}
                >
                  Edit
                </button>
              </div>
              <small>
                Status: {patch.status} · evidence {patch.evidenceIds.length}
              </small>
            </div>
          ))
        )}
      </Inspect>
    </div>
  );
}

function MemoryPanel(props: {
  memories: MemoryContext[];
  onToggle: (memory: MemoryContext) => void;
}): React.JSX.Element {
  const [query, setQuery] = useState("");
  const [type, setType] = useState("all");
  const visible = props.memories.filter(
    (memory) =>
      (type === "all" || memory.type === type) &&
      memory.summary.toLowerCase().includes(query.toLowerCase()),
  );
  return (
    <div className="panel-scroll">
      <div className="filters">
        <input
          aria-label="Search memories"
          placeholder="搜索 Memory"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <select value={type} onChange={(event) => setType(event.target.value)}>
          <option value="all">All types</option>
          {["episodic", "persona_related", "relationship", "correction", "reflection"].map(
            (value) => (
              <option key={value}>{value}</option>
            ),
          )}
        </select>
      </div>
      <p className="hint">关闭某条 Memory 后 Replay，可做 Memory Ablation。</p>
      {visible.map((memory) => (
        <div className={`memory-card ${memory.enabled ? "" : "disabled"}`} key={memory.id}>
          <div>
            <strong>{memory.type}</strong>
            <small>{memory.id.slice(-8)}</small>
          </div>
          <p>{memory.summary}</p>
          <small>
            importance {memory.importance.toFixed(2)} · topics {memory.topics.join(" / ") || "—"}
          </small>
          <button className="quiet-button" onClick={() => props.onToggle(memory)}>
            {memory.enabled ? "Disable" : "Enable"}
          </button>
        </div>
      ))}
    </div>
  );
}

function Inspect({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <section className="inspect">
      <h3>{title}</h3>
      {children}
    </section>
  );
}

function Code({ value }: { value: unknown }): React.JSX.Element {
  return <pre>{JSON.stringify(value, null, 2)}</pre>;
}

async function eventPause(event: AgentPublicEvent): Promise<void> {
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const duration = eventPauseDuration(event);
  if (duration > 0) await new Promise((resolve) => window.setTimeout(resolve, duration));
}

function errorText(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason);
}

const root = document.getElementById("root");
if (!root) throw new Error("Agent Lab root element is missing");
createRoot(root).render(<AgentLab />);
