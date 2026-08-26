import { Link } from "react-router-dom";

interface FeaturePlaceholderProps {
  eyebrow: string;
  title: string;
  description: string;
  nextPath?: string;
  nextLabel?: string;
}

export function FeaturePlaceholder({
  eyebrow,
  title,
  description,
  nextPath,
  nextLabel,
}: FeaturePlaceholderProps): React.JSX.Element {
  return (
    <section className="feature-page">
      <div className="feature-page__island" aria-hidden="true">
        <span />
      </div>
      <p className="eyebrow">{eyebrow}</p>
      <h1>{title}</h1>
      <p className="feature-page__description">{description}</p>
      <div className="feature-page__note">
        <strong>Foundation 状态</strong>
        <p>页面边界、共享视觉语言与 Contract 接缝已建立，业务数据仍使用明确占位。</p>
      </div>
      {nextPath && nextLabel && (
        <Link className="text-link" to={nextPath}>
          {nextLabel} <span aria-hidden="true">→</span>
        </Link>
      )}
    </section>
  );
}
