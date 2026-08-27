import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { ProductIdentity } from "@reso/contracts";
import { createConversation, loadIdentity } from "../../services/product.js";
import { LineIcon } from "../../components/LineIcon.js";
import { ResoAgentArtwork } from "../../components/ResoAgentArtwork.js";

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
    <section className="agent-birth-page page-enter">
      <div className="birth-sky" aria-hidden="true">
        <span className="birth-ring birth-ring--one" />
        <span className="birth-ring birth-ring--two" />
        <span className="birth-star star-one" />
        <span className="birth-star star-two" />
      </div>
      <div className="birth-layout">
        <div className="birth-visual">
          <ResoAgentArtwork alt="在紫色光轨中漂浮诞生的 Reso Agent" pose="birth" />
          <p className="birth-name">
            <span /> {identity?.agent?.name ?? "Reso"}
          </p>
        </div>
        <div className="birth-copy">
          <p className="eyebrow">Agent Birth · 初次见面</p>
          <h1>
            你的 Reso Agent
            <br />
            已经诞生。
          </h1>
          <p className="birth-lead">
            它已经带着你刚刚确认的 Personal Manual，准备好和你开始第一段真实对话。
          </p>
          <ul className="birth-knowledge">
            {["价值观", "沟通方式", "社交节奏", "关系需要", "边界"].map((item) => (
              <li key={item}>
                <LineIcon name="check" />
                {item}
              </li>
            ))}
          </ul>
          <p className="birth-promise">
            这只是第一版理解。{identity?.agent?.name ?? "Reso"}{" "}
            会在你每一次确认与纠正里，继续认识你。
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
            {!busy && <LineIcon name="arrow" />}
          </button>
        </div>
      </div>
    </section>
  );
}
