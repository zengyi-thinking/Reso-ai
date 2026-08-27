import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ensureGuest, submitQuickStart } from "../../services/product.js";
import { LineIcon } from "../../components/LineIcon.js";

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
    <section className="flow-page quick-start-page page-enter">
      <div className="flow-progress" aria-label="认识旅程：第 1 步，共 3 步">
        <span>01</span>
        <div>
          <i style={{ width: "33%" }} />
        </div>
        <small>简单认识你</small>
      </div>
      <header className="flow-heading">
        <p className="eyebrow">Quick Start · 简单认识你</p>
        <h1>先从你愿意说的地方开始。</h1>
        <p>没有标准答案。你写下的是初始线索，Reso 会保留不确定，也会听你的纠正。</p>
      </header>
      <form className="reso-form" onSubmit={submit}>
        <fieldset className="question-card question-card--weak">
          <legend>
            <span>01</span> 可选的轻线索
          </legend>
          <p>MBTI 和星座只作为弱证据，不会直接变成人格结论。</p>
          <div className="optional-pair">
            <label>
              MBTI <em>可选 · 弱证据</em>
              <input name="mbti" placeholder="例如 INFJ" maxLength={12} />
            </label>
            <label>
              星座 <em>可选 · 弱证据</em>
              <input name="zodiac" placeholder="例如 双鱼座" maxLength={20} />
            </label>
          </div>
        </fieldset>
        <label className="question-card">
          <span className="question-card__title">
            <b>02</b> 你现在更期待怎样的关系？
          </span>
          <textarea
            required
            name="relationshipGoal"
            placeholder="例如：真诚、稳定，也能保留彼此空间"
          />
        </label>
        <label className="question-card">
          <span className="question-card__title">
            <b>03</b> 你喜欢怎样沟通？
          </span>
          <textarea
            required
            name="communicationPreference"
            placeholder="例如：有内容、直接，但不要太有压迫感"
          />
        </label>
        <label className="question-card">
          <span className="question-card__title">
            <b>04</b> 你舒服的社交节奏是什么？
          </span>
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
        <button className="reso-button reso-button--wide" disabled={!ready || submitting}>
          {submitting ? "正在整理这些线索…" : "看看 Reso 目前怎么理解我"}
          {!submitting && <LineIcon name="arrow" />}
        </button>
      </form>
    </section>
  );
}
