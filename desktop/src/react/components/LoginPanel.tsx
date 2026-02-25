import { Building2, KeyRound, LogIn, ShieldCheck, User } from "lucide-react";
import { useState } from "react";
import type { FormEventHandler } from "react";
import { activateWithCode, login, loginWithFeishu } from "../lib/auth";

export default function LoginPanel() {
  const [mode, setMode] = useState<"login" | "activate">("login");
  const [username, setUsername] = useState("");
  const [secret, setSecret] = useState("");
  const [code, setCode] = useState("");
  const [newUsername, setNewUsername] = useState("");
  const [newSecret, setNewSecret] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const onSubmit: FormEventHandler<HTMLFormElement> = async (event) => {
    event.preventDefault();
    setLoading(true);
    setError("");
    try {
      if (mode === "login") {
        await login(username, secret);
      } else {
        await activateWithCode(code, newUsername, newSecret);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "登录失败");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-wrapper">
      <form className="login-card" onSubmit={onSubmit}>
        <h1 className="logo">JAcoworks AI</h1>
        <p className="subtitle">企业 AI 协同办公平台</p>

        {error && <div className="error-box">{error}</div>}

        <div className="tabs">
          <button type="button" className={`tab ${mode === "login" ? "active" : ""}`} onClick={() => setMode("login")}>
            <LogIn size={14} />
            登录
          </button>
          <button type="button" className={`tab ${mode === "activate" ? "active" : ""}`} onClick={() => setMode("activate")}>
            <KeyRound size={14} />
            激活码
          </button>
        </div>

        {mode === "login" ? (
          <>
            <label className="field">
              <User size={14} />
              <input
                type="text"
                value={username}
                placeholder="用户名"
                autoComplete="username"
                onChange={(event) => setUsername(event.target.value)}
                disabled={loading}
              />
            </label>
            <label className="field">
              <ShieldCheck size={14} />
              <input
                type="password"
                value={secret}
                placeholder="密码"
                autoComplete="current-password"
                onChange={(event) => setSecret(event.target.value)}
                disabled={loading}
              />
            </label>
            <button type="submit" className="btn-primary" disabled={loading || !username || !secret}>
              登录
            </button>
          </>
        ) : (
          <>
            <label className="field">
              <KeyRound size={14} />
              <input
                type="text"
                value={code}
                placeholder="激活码"
                onChange={(event) => setCode(event.target.value)}
                disabled={loading}
              />
            </label>
            <label className="field">
              <User size={14} />
              <input
                type="text"
                value={newUsername}
                placeholder="用户名"
                autoComplete="username"
                onChange={(event) => setNewUsername(event.target.value)}
                disabled={loading}
              />
            </label>
            <label className="field">
              <ShieldCheck size={14} />
              <input
                type="password"
                value={newSecret}
                placeholder="设置密码"
                autoComplete="new-password"
                onChange={(event) => setNewSecret(event.target.value)}
                disabled={loading}
              />
            </label>
            <button type="submit" className="btn-primary" disabled={loading || !code || !newUsername || !newSecret}>
              激活并登录
            </button>
          </>
        )}

        <div className="divider">
          <span>或</span>
        </div>

        <button type="button" className="btn-secondary" disabled={loading} onClick={() => loginWithFeishu()}>
          <Building2 size={14} />
          飞书 SSO 登录
        </button>
      </form>
    </div>
  );
}
