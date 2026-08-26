import { useState } from "react";
import { Link } from "react-router-dom";

type ReviewChoice = "accepted" | "rejected" | null;

export function PatchReviewPage(): React.JSX.Element {
  const [choice, setChoice] = useState<ReviewChoice>(null);

  return (
    <section className="feature-page patch-review">
      <p className="eyebrow">Persona Patch · Review</p>
      <h1>由你决定，理解是否改变</h1>
      <p className="feature-page__description">
        Reso Agent 只能提出带证据的候选修改。只有你确认后，Product API 才能创建新 Persona Version。
      </p>

      <article className="patch-card" aria-label="Persona 修改候选示例">
        <div className="patch-card__meta">
          <span>示例候选</span>
          <span>信心 76%</span>
        </div>
        <p className="patch-card__label">社交方式</p>
        <p className="patch-card__change">
          <del>慢热</del>
          <span aria-hidden="true">→</span>
          <ins>对低价值社交主动性较低</ins>
        </p>
        <p className="patch-card__reason">
          依据：你明确纠正了“只是慢热”的解释。一次表达只形成候选，不会自动成为事实。
        </p>
        <div className="patch-card__actions" aria-label="审查候选修改">
          <button type="button" onClick={() => setChoice("accepted")}>
            这个理解更准确
          </button>
          <button type="button" className="secondary-action" onClick={() => setChoice("rejected")}>
            保留原来的理解
          </button>
        </div>
        <p className="patch-card__status" aria-live="polite">
          {choice === null && "Foundation 演示：此处不会提交真实数据。"}
          {choice === "accepted" && "已记录演示选择；正式版本仍需由 Product API 原子提交。"}
          {choice === "rejected" && "已记录演示拒绝；当前 Persona 保持不变。"}
        </p>
      </article>

      <Link className="text-link" to="/agent-chat">
        去见你的 Reso Agent <span aria-hidden="true">→</span>
      </Link>
    </section>
  );
}
