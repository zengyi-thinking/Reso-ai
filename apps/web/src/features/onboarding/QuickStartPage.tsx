import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ensureGuest, submitQuickStart } from "../../services/product.js";

export function QuickStartPage(): React.JSX.Element {
  const navigate = useNavigate();
  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  useEffect(() => {
    void ensureGuest()
      .then(() => setReady(true))
      .catch((reason: Error) => setError(reason.message));
  }, []);
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError("");
    const data = new FormData(event.currentTarget);
    try {
      await submitQuickStart({
        mbti: String(data.get("mbti") ?? "").trim() || null,
        zodiac: String(data.get("zodiac") ?? "").trim() || null,
        relationshipGoal: String(data.get("relationshipGoal") ?? ""),
        communicationPreference: String(data.get("communicationPreference") ?? ""),
        socialPreference: String(data.get("socialPreference") ?? ""),
      });
      navigate("/persona-draft");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "生成失败");
      setSubmitting(false);
    }
  }
  return (
    <section className="flow-page quick-start-page">
      <header className="flow-heading">
        <p className="eyebrow">Quick Start · 简单认识你</p>
        <h1>先从几个轻一点的问题开始。</h1>
        <p>它们只是初始线索，不会把你变成一个 MBTI 或星座标签。</p>
      </header>
      <form className="reso-form" onSubmit={submit}>
        <div className="optional-pair">
          <label>
            MBTI <span>可选</span>
            <input name="mbti" placeholder="例如 INFJ" maxLength={12} />
          </label>
          <label>
            星座 <span>可选</span>
            <input name="zodiac" placeholder="例如 双鱼座" maxLength={20} />
          </label>
        </div>
        <label>
          你现在更期待怎样的关系？
          <textarea
            required
            name="relationshipGoal"
            placeholder="例如：真诚、稳定，也能保留彼此空间"
          />
        </label>
        <label>
          你喜欢怎样沟通？
          <textarea
            required
            name="communicationPreference"
            placeholder="例如：有内容、直接，但不要太有压迫感"
          />
        </label>
        <label>
          你舒服的社交节奏是什么？
          <textarea
            required
            name="socialPreference"
            placeholder="例如：不需要很多人，更喜欢少量深入的连接"
          />
        </label>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <button className="reso-button" disabled={!ready || submitting}>
          {submitting ? "正在整理这些线索…" : "看看 Reso 目前怎么理解我"}
        </button>
      </form>
    </section>
  );
}
