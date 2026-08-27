import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { ProductIdentity } from "@reso/contracts";
import { createConversation, loadIdentity } from "../../services/product.js";

export function AgentBirthPage(): React.JSX.Element {
  const navigate = useNavigate();
  const [identity, setIdentity] = useState<ProductIdentity | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    void loadIdentity()
      .then(setIdentity)
      .catch((reason: Error) => setError(reason.message));
  }, []);
  async function chat() {
    setBusy(true);
    try {
      const conversation = await createConversation();
      navigate(`/chat/${conversation.id}`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "创建对话失败");
      setBusy(false);
    }
  }
  return (
    <section className="agent-birth-page">
      <div className="birth-sky" aria-hidden="true">
        <span className="birth-star star-one">✦</span>
        <span className="birth-star star-two">·</span>
      </div>
      <div className="agent-avatar" aria-hidden="true">
        <span className="agent-avatar__face">⌒‿⌒</span>
      </div>
      <p className="eyebrow">Agent Birth · 初次见面</p>
      <h1>
        你的 Reso Agent
        <br />
        已经诞生。
      </h1>
      <p className="birth-lead">
        它现在已经知道你的一些价值观、沟通偏好、社交节奏、关系需要与边界。
      </p>
      <p className="birth-promise">
        不过这只是第一版理解。
        <br />
        {identity?.agent?.name ?? "Reso"} 会在你每次确认和纠正中，慢慢更懂你。
      </p>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <button
        className="reso-button reso-button--apricot"
        disabled={busy || identity?.agent === null}
        onClick={() => void chat()}
      >
        {busy ? "正在打开第一段对话…" : "和它聊聊"}
      </button>
    </section>
  );
}
