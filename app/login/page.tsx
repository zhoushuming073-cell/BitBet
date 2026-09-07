"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { loginUser } from "@/services/account-service";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setSubmitting(true);
    try {
      await loginUser(email, password);
      router.push("/profile");
    } catch (err) {
      setError(err instanceof Error ? err.message : "登录失败，请重试");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className="account-page">
      <div className="account-card">
        <h1 className="auth-title">登录</h1>
        <p className="auth-sub">登录后同步资产与战绩</p>
        <form onSubmit={submit}>
          <input
            className="auth-input"
            type="email"
            placeholder="邮箱"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="email"
            autoFocus
            required
          />
          <input
            className="auth-input"
            type="password"
            placeholder="密码"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            required
          />
          <button className="auth-button" type="submit" disabled={submitting}>
            {submitting ? "登录中…" : "登录"}
          </button>
        </form>
        {error ? <div className="auth-error">{error}</div> : null}
        <span className="auth-link">
          还没有账号？<Link href="/register">注册</Link>
        </span>
      </div>
    </main>
  );
}
