"use client";

import Link from "next/link";
import { useAccount } from "./use-account";

/** Topbar account entry — username (to profile) or login/register for guests. */
export function AccountEntry() {
  const { account, loading } = useAccount();

  if (loading) {
    return <span className="account-entry account-entry-muted">…</span>;
  }

  if (account) {
    return (
      <Link href="/profile" className="account-entry">
        <span className="account-dot" aria-hidden="true" />
        <span>{account.username}</span>
      </Link>
    );
  }

  return (
    <span className="account-entry">
      <Link href="/login">登录</Link>
      <Link href="/register" className="account-entry-primary">注册</Link>
    </span>
  );
}
