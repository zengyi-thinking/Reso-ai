import { Link } from "react-router-dom";

export function JourneyPage(): React.JSX.Element {
  return (
    <section className="journey-card">
      <div className="journey-card__progress" aria-label="Journey 示例进度 1 / 8">
        <span style={{ width: "12.5%" }} />
      </div>
      <p className="eyebrow">Journey · 01 / 08</p>
      <h1>来到一座陌生的小岛，你更想先做什么？</h1>
      <div className="choice-list">
        <button type="button">沿着海岸慢慢走一圈</button>
        <button type="button">找一个安静的地方观察</button>
        <button type="button">和岛上遇见的人聊聊</button>
      </div>
      <Link className="text-link" to="/persona">
        查看 Persona Draft 占位 <span aria-hidden="true">→</span>
      </Link>
      <p className="privacy-note">这里的选择只形成可修改草稿，不会直接定义你。</p>
    </section>
  );
}
