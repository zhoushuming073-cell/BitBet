"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { registerUser } from "@/services/account-service";

export default function RegisterPage() {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setSubmitting(true);
    try {
      await registerUser(username);
      router.push("/profile");
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
        <p className="auth-sub">注册后保存资产、战绩并参与排行榜</p>
        <form onSubmit={submit}>
          <input
            className="auth-input"
            type="text"
            placeholder="用户名（3~20 字符）"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoComplete="off"
            maxLength={20}
            autoFocus
          />
          <button className="auth-button" type="submit" disabled={submitting}>
            {submitting ? "注册中…" : "注册"}
          </button>
        </form>
        {error ? <div className="auth-error">{error}</div> : null}
        <span className="auth-link">
          已有账号？<Link href="/login">登录</Link>
        </span>
      </div>
    </main>
  );
}
