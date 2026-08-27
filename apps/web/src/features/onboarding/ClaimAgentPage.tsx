import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { claimAgent, sendEmailCode, verifyEmailCode } from "../../services/product.js";

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
    <section className="flow-page claim-page">
      <div className="birth-orb" aria-hidden="true">
        <span>R</span>
      </div>
      <header className="flow-heading">
        <p className="eyebrow">Claim · 把这份理解带回家</p>
        <h1>领取你的 Reso Agent。</h1>
        <p>只需要邮箱验证码。没有密码，也不会把 SMTP 凭据交给浏览器。</p>
      </header>
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
            />
          </label>
        )}
        <p className="privacy-note">验证码 10 分钟内有效，验证成功后立即失效。</p>
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
          <button
            className="reso-button"
            disabled={busy || code.length !== 6}
            onClick={() => void verify()}
          >
            {busy ? "正在绑定…" : "验证并领取 Agent"}
          </button>
        )}
      </div>
    </section>
  );
}
