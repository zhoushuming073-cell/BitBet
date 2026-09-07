"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { completeEmailRegistration, startEmailRegistration } from "@/services/account-service";

export default function RegisterPage() {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [code, setCode] = useState("");
  const [verificationSent, setVerificationSent] = useState(false);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setSubmitting(true);
    try {
      if (!verificationSent) {
        if (password !== confirmPassword) throw new Error("两次输入的密码不一致");
        await startEmailRegistration({ email, username, password });
        setVerificationSent(true);
      } else {
        await completeEmailRegistration(code, username);
        router.push("/profile");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "注册失败，请重试");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className="account-page">
      <div className="account-card">
        <h1 className="auth-title">注册</h1>
        <p className="auth-sub">邮箱验证后，资产与战绩可跨设备同步</p>
        <form onSubmit={submit}>
          <input
            className="auth-input"
            type="email"
            placeholder="邮箱"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="email"
            disabled={verificationSent}
            required
            autoFocus
          />
          <input
            className="auth-input"
            type="text"
            placeholder="用户名（3~20 位）"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoComplete="username"
            minLength={3}
            maxLength={20}
            disabled={verificationSent}
            required
          />
          {!verificationSent ? (
            <>
              <input
                className="auth-input"
                type="password"
                placeholder="密码（至少 8 位）"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="new-password"
                minLength={8}
                required
              />
              <input
                className="auth-input"
                type="password"
                placeholder="确认密码"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                autoComplete="new-password"
                minLength={8}
                required
              />
            </>
          ) : (
            <input
              className="auth-input"
              type="text"
              inputMode="numeric"
              placeholder="邮箱验证码"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              autoComplete="one-time-code"
              required
              autoFocus
            />
          )}
          <button className="auth-button" type="submit" disabled={submitting}>
            {submitting ? "请稍候…" : verificationSent ? "完成注册" : "发送验证码"}
          </button>
        </form>
        {verificationSent ? <p className="auth-sub">验证码已发送至 {email}</p> : null}
        {error ? <div className="auth-error">{error}</div> : null}
        <span className="auth-link">
          已有账号？<Link href="/login">登录</Link>
        </span>
      </div>
    </main>
  );
}
