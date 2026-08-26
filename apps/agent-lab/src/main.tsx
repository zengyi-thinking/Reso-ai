import { createRoot } from "react-dom/client";
import "./style.css";

const fields = [
  "Input",
  "Persona Version",
  "Memory Retrieval",
  "Relationship Context",
  "Selected Mode",
  "Policy",
  "Tools",
  "Model",
  "Response",
  "Memory Candidate",
  "Persona Patch Candidate",
  "Eval",
];

function AgentLab(): React.JSX.Element {
  return (
    <main>
      <p className="eyebrow">Internal Development Tool</p>
      <h1>Reso Agent Lab</h1>
      <p className="lead">只显示允许的 trace 字段；不保存 Chain-of-Thought 或真实用户隐私数据。</p>
      <section className="trace-grid">
        {fields.map((field) => (
          <article key={field}>
            <strong>{field}</strong>
            <span>等待本地 trace fixture</span>
          </article>
        ))}
      </section>
    </main>
  );
}

const root = document.getElementById("root");
if (!root) throw new Error("Agent Lab root element is missing");
createRoot(root).render(<AgentLab />);
