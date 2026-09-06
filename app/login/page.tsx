"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { loginUser } from "@/services/account-service";

export default function LoginPage() {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setSubmitting(true);
    try {
      await loginUser(username);
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
        <p className="auth-sub">使用你的用户名登录</p>
        <form onSubmit={submit}>
          <input
            className="auth-input"
            type="text"
            placeholder="用户名"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoComplete="off"
            maxLength={20}
            autoFocus
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
