import { Link } from "react-router-dom";
import { LineIcon } from "../../components/LineIcon.js";
import { ResoAgentArtwork } from "../../components/ResoAgentArtwork.js";

export function WelcomePage(): React.JSX.Element {
  return (
    <section className="welcome page-enter">
      <div className="welcome__atmosphere" aria-hidden="true">
        <span className="orbit orbit--one" />
        <span className="orbit orbit--two" />
        <span className="star-point star-point--one" />
        <span className="star-point star-point--two" />
        <span className="star-point star-point--three" />
      </div>
      <div className="welcome__copy">
        <p className="eyebrow">Reso 正在认识你</p>
        <h1>
          从被理解开始，
          <br />
          慢慢靠近真实的关系。
        </h1>
        <p className="welcome__lead">
          先回答几个轻一点的问题。Reso 会写下第一版属于你的 Personal
          Manual，陪你在之后的每一次对话里继续认识自己。
        </p>
        <Link className="primary-action" to="/quick-start">
          开始认识自己 <LineIcon name="arrow" />
        </Link>
        <p className="privacy-note">
          不是人格测试，也不会把一次回答变成标签。每一份理解都可以由你修改。
        </p>
      </div>
      <div className="welcome__visual">
        <span className="welcome__halo" aria-hidden="true" />
        <ResoAgentArtwork
          alt="挥手欢迎你的 Reso Agent"
          className="welcome__mascot"
          pose="welcome"
        />
        <div className="welcome__whisper">
          <span aria-hidden="true" />
          我们慢慢来。
        </div>
      </div>
    </section>
  );
}
