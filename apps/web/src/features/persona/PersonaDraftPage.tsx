import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { PersonaContent } from "@reso/contracts";
import { confirmPersona, loadGuest } from "../../services/product.js";

const lines = (value: string) =>
  value
    .split("\n")
    .map((item) => item.trim())
    .filter(Boolean);
export function PersonaDraftPage(): React.JSX.Element {
  const navigate = useNavigate();
  const [draft, setDraft] = useState<PersonaContent | null>(null);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    void loadGuest()
      .then((guest) => {
        const content = guest.personaDraft;
        if (content === null) navigate("/quick-start", { replace: true });
        else setDraft(content);
      })
      .catch((reason: Error) => setError(reason.message));
  }, [navigate]);
  if (draft === null)
    return (
      <section className="flow-page">
        <p className="breathing-copy">Reso 正在展开你的初步说明书…</p>
        {error && <p className="form-error">{error}</p>}
      </section>
    );
  function update<K extends keyof PersonaContent>(key: K, value: PersonaContent[K]) {
    setDraft((current) => (current === null ? current : { ...current, [key]: value }));
  }
  async function confirm(content: PersonaContent) {
    setSaving(true);
    setError("");
    try {
      await confirmPersona(content);
      navigate("/claim-agent");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "保存失败");
      setSaving(false);
    }
  }
  return (
    <section className="flow-page persona-draft-page">
      <header className="flow-heading">
        <p className="eyebrow">Persona Draft · 你的初步说明书</p>
        <h1>这是我目前对你的理解。</h1>
        <p>你可以直接改。你的修改会被保留为明确纠正，而不是被下一次模型猜测覆盖。</p>
      </header>
      <div className="persona-editor">
        <DraftField
          title="你看重的事"
          value={draft.values.join("\n")}
          onChange={(value) => update("values", lines(value))}
        />
        <DraftField
          title="你的沟通方式"
          value={String(draft.communicationStyle.preference ?? "")}
          onChange={(value) =>
            update("communicationStyle", { ...draft.communicationStyle, preference: value })
          }
        />
        <DraftField
          title="你的社交节奏"
          value={String(draft.socialStyle.rhythm ?? "")}
          onChange={(value) => update("socialStyle", { ...draft.socialStyle, rhythm: value })}
        />
        <DraftField
          title="关系里的需要"
          value={draft.relationshipNeeds.join("\n")}
          onChange={(value) => update("relationshipNeeds", lines(value))}
        />
        <DraftField
          title="希望被尊重的边界"
          value={draft.boundaries.join("\n")}
          onChange={(value) => update("boundaries", lines(value))}
        />
      </div>
      <aside className="weak-evidence-note">
        MBTI 与星座只保留在弱证据区。Reso 不会用它们替你下人格结论。
      </aside>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <button className="reso-button" onClick={() => void confirm(draft)} disabled={saving}>
        {saving ? "正在保存你的修正…" : "确认并领取我的 Reso Agent"}
      </button>
    </section>
  );
}
function DraftField({
  title,
  value,
  onChange,
}: {
  title: string;
  value: string;
  onChange(value: string): void;
}) {
  return (
    <label className="persona-editor__field">
      <span>{title}</span>
      <textarea value={value} onChange={(event) => onChange(event.target.value)} />
    </label>
  );
}
