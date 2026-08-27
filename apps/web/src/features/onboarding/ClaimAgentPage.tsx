import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { claimAgent, sendEmailCode, verifyEmailCode } from "../../services/product.js";
import { LineIcon } from "../../components/LineIcon.js";
import { ResoAgentArtwork } from "../../components/ResoAgentArtwork.js";

export function ClaimAgentPage(): React.JSX.Element {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function send() {
    setBusy(true);
    setError("");
    try {
      await sendEmailCode(email);
      setSent(true);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "发送失败");
    } finally {
      setBusy(false);
    }
  }
  async function verify() {
    setBusy(true);
    setError("");
    try {
      await verifyEmailCode(email, code);
      await claimAgent();
      navigate("/agent-birth");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "验证失败");
      setBusy(false);
    }
  }
  return (
    <section className="flow-page claim-page page-enter">
      <div className="flow-progress" aria-label="认识旅程：第 3 步，共 3 步">
        <span>03</span>
        <div>
          <i style={{ width: "100%" }} />
        </div>
        <small>领取你的 Reso</small>
      </div>
      <div className="claim-layout">
        <div className="claim-visual">
          <span className="claim-visual__halo" aria-hidden="true" />
          <ResoAgentArtwork alt="用柔和护盾守护隐私的 Reso Agent" pose="guardian" />
          <div className="privacy-seal">
            <LineIcon name="lock" /> 只属于你的理解
          </div>
        </div>
        <div className="claim-content">
          <header className="flow-heading">
            <p className="eyebrow">Claim · 把这份理解带回家</p>
            <h1>{sent ? "去邮箱看看，验证码已经在路上。" : "领取你的 Reso Agent。"}</h1>
            <p>
              {sent
                ? `我们把 6 位验证码发送到了 ${email}。`
                : "不需要设置密码。用邮箱验证码，把刚刚的回答和 Persona 安全地带到正式账户。"}
            </p>
          </header>
          <div className="auth-steps" aria-label="领取进度">
            <span className="is-done">
              <LineIcon name="check" /> 确认 Persona
            </span>
            <span className={sent ? "is-active" : ""}>
              <LineIcon name="mail" /> 邮箱验证
            </span>
            <span>
              <LineIcon name="spark" /> Agent 诞生
            </span>
          </div>
          <div className="reso-form auth-form">
            <label>
              邮箱
              <input
                type="email"
                autoComplete="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="you@example.com"
              />
            </label>
            {sent && (
              <label>
                6 位验证码
                <input
                  className="code-input"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={6}
                  value={code}
                  onChange={(event) => setCode(event.target.value.replace(/\D/g, ""))}
                  placeholder="000000"
                  autoFocus
                />
              </label>
            )}
            <p className="privacy-note">
              <LineIcon name="lock" /> 验证码 10 分钟内有效，使用后立即失效。
            </p>
            {error && (
              <p className="form-error" role="alert">
                {error}
              </p>
            )}
            {!sent ? (
              <button
                className="reso-button"
                disabled={busy || !email.includes("@")}
                onClick={() => void send()}
              >
                {busy ? "正在寄出…" : "发送验证码"}
              </button>
            ) : (
              <>
                <button
                  className="reso-button"
                  disabled={busy || code.length !== 6}
                  onClick={() => void verify()}
                >
                  {busy ? "正在绑定…" : "验证并领取 Agent"}
                  {!busy && <LineIcon name="arrow" />}
                </button>
                <button
                  className="auth-back"
                  disabled={busy}
                  onClick={() => {
                    setSent(false);
                    setCode("");
                  }}
                >
                  换一个邮箱
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
