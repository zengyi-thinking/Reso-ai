import { Link } from "react-router-dom";

export function WelcomePage(): React.JSX.Element {
  return (
    <section className="welcome">
      <div className="sky-scene" aria-hidden="true">
        <span className="cloud cloud--one" />
        <span className="cloud cloud--two" />
        <span className="island island--far" />
        <span className="island island--near" />
        <span className="bridge" />
      </div>
      <div className="welcome__copy">
        <p className="eyebrow">一段认识自己的旅程</p>
        <h1>
          有些理解，
          <br />
          需要慢慢抵达。
        </h1>
        <p className="welcome__lead">
          Reso.AI 会从一次约八轮的小旅程开始，陪你写下第一版属于自己的 Personal Manual。
        </p>
        <Link className="primary-action" to="/journey">
          开始这段旅程
        </Link>
        <p className="privacy-note">你的回答不会自动变成标签；每一次理解都可以被你修正。</p>
      </div>
    </section>
  );
}
