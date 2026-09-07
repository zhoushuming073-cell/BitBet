-- settlements is the fact table. wallets.pending_claim is only a materialized total.
-- This query is safe to run after import/recovery to repair every wallet.
UPDATE wallets AS w
LEFT JOIN (
  SELECT user_id, COALESCE(SUM(payout), 0.00) AS expected_pending
  FROM settlements
  WHERE claim_status = 'pending'
  GROUP BY user_id
) AS s ON s.user_id = w.user_id
SET w.pending_claim = COALESCE(s.expected_pending, 0.00),
    w.updated_at = CAST(UNIX_TIMESTAMP(CURRENT_TIMESTAMP(3)) * 1000 AS UNSIGNED),
    w.version = w.version + 1
WHERE w.pending_claim <> COALESCE(s.expected_pending, 0.00);
