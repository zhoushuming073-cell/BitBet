"use client";

import { useCallback, useEffect, useState } from "react";
import { getCurrentAccount, type AccountUser } from "@/services/account-service";

export function useAccount() {
  const [account, setAccount] = useState<AccountUser | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    const acc = await getCurrentAccount();
    setAccount(acc);
    return acc;
  }, []);

  useEffect(() => {
    let alive = true;
    getCurrentAccount()
      .then((acc) => {
        if (alive) setAccount(acc);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, []);

  return { account, loading, refresh };
}
