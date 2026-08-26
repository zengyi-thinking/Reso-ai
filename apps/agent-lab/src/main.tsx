import { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import type {
  LabSession,
  LabTurn,
  LabUser,
  MemoryContext,
  PersonaPatchCandidate,
} from "@reso/contracts";
import "./style.css";

const apiBase = import.meta.env.VITE_AGENT_SERVICE_URL ?? "http://localhost:8000";
type Panel = "inspector" | "persona" | "memory";

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

function AgentLab(): React.JSX.Element {
  const [users, setUsers] = useState<LabUser[]>([]);
  const [provider, setProvider] = useState<"deterministic" | "real">("deterministic");
  const [session, setSession] = useState<LabSession | null>(null);
  const [selectedTurnId, setSelectedTurnId] = useState<string | null>(null);
  const [panel, setPanel] = useState<Panel>("inspector");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selectedTurn = useMemo(
    () => session?.turns.find((turn) => turn.id === selectedTurnId) ?? session?.turns.at(-1),
    [selectedTurnId, session],
  );

  useEffect(() => {
    void api<LabUser[]>("/v1/lab/users")
      .then(setUsers)
      .catch((reason: unknown) =>
        setError(reason instanceof Error ? reason.message : String(reason)),
      );
  }, []);

  async function startSession(): Promise<void> {
    const user = users[0];
    if (!user) return;
    await run(async () => {
      const created = await api<LabSession>("/v1/lab/sessions", {
        method: "POST",
        body: JSON.stringify({ userSlug: user.slug, provider }),
      });
      setSession(created);
      setSelectedTurnId(null);
    });
  }

  async function refresh(): Promise<void> {
    if (!session) return;
    setSession(await api<LabSession>(`/v1/lab/sessions/${session.id}`));
  }

  async function send(replayTurnId?: string): Promise<void> {
    if (!session || (!message.trim() && !replayTurnId)) return;
    const payload: { message: string; replayTurnId?: string } = {
      message: replayTurnId ? (selectedTurn?.input ?? "replay") : message.trim(),
    };
    if (replayTurnId) payload.replayTurnId = replayTurnId;
    await run(async () => {
      const turn = await api<LabTurn>(`/v1/lab/sessions/${session.id}/turns`, {
        method: "POST",
        body: JSON.stringify(payload),
      });
      await refresh();
      setSelectedTurnId(turn.id);
      setMessage("");
    });
  }

  async function simulate(day: 1 | 7 | 30): Promise<void> {
    if (!session) return;
    await run(async () => {
      const turns = await api<LabTurn[]>(`/v1/lab/sessions/${session.id}/simulate/${day}`, {
        method: "POST",
      });
      await refresh();
      setSelectedTurnId(turns.at(-1)?.id ?? null);
    });
  }

  async function clear(): Promise<void> {
    if (!session) return;
    await run(async () => {
      await api(`/v1/lab/sessions/${session.id}`, { method: "DELETE" });
      setSession(null);
      setSelectedTurnId(null);
    });
  }

  async function run(action: () => Promise<void>): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main>
      <header className="topbar">
        <div>
          <p className="eyebrow">Synthetic Data · Internal Development</p>
          <h1>Reso Agent Lab</h1>
          <p className="lead">看见 Agent 如何记住、纠正与逐步理解一个人。</p>
        </div>
        <div className="session-controls">
          <label>
            测试用户
            <select disabled value={users[0]?.slug ?? "loading"}>
              <option>{users[0]?.displayName ?? "加载中…"}</option>
            </select>
          </label>
          <label>
            Model Route
            <select
              value={provider}
              onChange={(event) => setProvider(event.target.value as "deterministic" | "real")}
            >
              <option value="deterministic">Deterministic · CI</option>
              <option value="real">MiniMax · Opt-in</option>
            </select>
          </label>
          <button disabled={busy || users.length === 0} onClick={() => void startSession()}>
            新 Session
          </button>
          <button className="ghost" disabled={!session || busy} onClick={() => void clear()}>
            清空
          </button>
        </div>
      </header>

      {error ? <p className="error">{error}</p> : null}
      {!session ? (
        <section className="empty-state">
          <span>01</span>
          <h2>从 Alice 的 Personal Manual v1.0 开始</h2>
          <p>创建 Session 后，可连续聊天、运行 Day 1/7/30、关闭 Correction Memory 再 Replay。</p>
        </section>
      ) : (
        <>
          <nav className="timeline" aria-label="Longitudinal simulation">
            <span>Longitudinal Simulation</span>
            {([1, 7, 30] as const).map((day) => (
              <button key={day} disabled={busy} onClick={() => void simulate(day)}>
                Day {day}
              </button>
            ))}
            <strong>{session.persona.version}</strong>
          </nav>
          <section className="workspace">
            <Conversation
              busy={busy}
              message={message}
              onMessage={setMessage}
              onReplay={() => selectedTurn && void send(selectedTurn.id)}
              onSelect={setSelectedTurnId}
              onSend={() => void send()}
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
                    void run(async () => {
                      await api(`/v1/lab/sessions/${session.id}/patches/${patch.id}`, {
                        method: "PATCH",
                        body: JSON.stringify({ decision, proposedValue }),
                      });
                      await refresh();
                    })
                  }
                />
              ) : null}
              {panel === "memory" ? (
                <MemoryPanel
                  memories={session.memories}
                  onToggle={(memory) =>
                    void run(async () => {
                      await api(`/v1/lab/sessions/${session.id}/memories/${memory.id}`, {
                        method: "PATCH",
                        body: JSON.stringify({ enabled: !memory.enabled }),
                      });
                      await refresh();
                    })
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
  busy: boolean;
  onSelect: (id: string) => void;
  onMessage: (value: string) => void;
  onSend: () => void;
  onReplay: () => void;
}): React.JSX.Element {
  return (
    <section className="conversation">
      <div className="section-title">
        <div>
          <span>Conversation</span>
          <small>{props.turns.length} turns</small>
        </div>
        <button
          className="ghost"
          disabled={!props.selectedTurnId || props.busy}
          onClick={props.onReplay}
        >
          Replay
        </button>
      </div>
      <div className="messages">
        {props.turns.length === 0 ? <p className="muted">还没有对话。可以先运行 Day 1。</p> : null}
        {props.turns.map((turn) => (
          <button
            className={`turn ${props.selectedTurnId === turn.id ? "selected" : ""}`}
            key={turn.id}
            onClick={() => props.onSelect(turn.id)}
          >
            <span className="user-message">{turn.input}</span>
            <span className="agent-message">{turn.response}</span>
            <small>
              {turn.mode} · {turn.model.provider} · {turn.model.latencyMs}ms
            </small>
          </button>
        ))}
      </div>
      <div className="composer">
        <textarea
          aria-label="Message"
          placeholder="和 Alice 的 Reso Agent 继续聊…"
          value={props.message}
          onChange={(event) => props.onMessage(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              props.onSend();
            }
          }}
        />
        <button disabled={props.busy || !props.message.trim()} onClick={props.onSend}>
          发送
        </button>
      </div>
    </section>
  );
}

function TurnInspector({ turn }: { turn: LabTurn | undefined }): React.JSX.Element {
  if (!turn) return <p className="muted panel-copy">点击一个 Turn 查看可审计上下文。</p>;
  return (
    <div className="panel-scroll">
      <Inspect title="Input">
        <p>{turn.input}</p>
      </Inspect>
      <Inspect title="Persona">
        <Code value={{ version: turn.personaVersion, fields: turn.personaFields }} />
      </Inspect>
      <Inspect title="Retrieved Memories">
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
      <Inspect title="Pending Patch">
        {props.patches.length === 0 ? (
          <p className="muted">还没有 Patch。Day 7 的明确纠正会产生一个。</p>
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
                  className="ghost"
                  disabled={patch.status !== "pending"}
                  onClick={() => props.onDecision(patch, "reject")}
                >
                  Reject
                </button>
                <button
                  className="ghost"
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
          <button className="ghost" onClick={() => props.onToggle(memory)}>
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

const root = document.getElementById("root");
if (!root) throw new Error("Agent Lab root element is missing");
createRoot(root).render(<AgentLab />);
