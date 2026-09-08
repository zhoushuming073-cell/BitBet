/** Coded engine errors. These codes are part of the API contract. */
export const ErrorCode = {
  ROUND_LOCKED: "ROUND_LOCKED",
  NO_ROUND_OPEN: "NO_ROUND_OPEN",
  MARKET_OFFLINE: "MARKET_OFFLINE",
  VOLATILITY_WARMING_UP: "VOLATILITY_WARMING_UP",
  MARKET_ONE_SIDED: "MARKET_ONE_SIDED",
  INSUFFICIENT_BALANCE: "INSUFFICIENT_BALANCE",
  BELOW_MIN_BET: "BELOW_MIN_BET",
  INVALID_STAKE: "INVALID_STAKE",
  RATE_LIMITED: "RATE_LIMITED",
  DUPLICATE_REQUEST: "DUPLICATE_REQUEST",
  INVALID_SIDE: "INVALID_SIDE",
  NOTHING_TO_HEDGE: "NOTHING_TO_HEDGE",
  ROUND_NOT_SETTLED: "ROUND_NOT_SETTLED",
} as const;

export type ErrorCodeType = (typeof ErrorCode)[keyof typeof ErrorCode];

export const USER_FACING_MESSAGE: Record<ErrorCodeType, string> = {
  ROUND_LOCKED: "本轮已封盘，最后 15 秒禁止下单",
  NO_ROUND_OPEN: "正在连接行情…",
  MARKET_OFFLINE: "正在连接 BTC 行情",
  VOLATILITY_WARMING_UP: "行情预热中，暂时无法下注",
  MARKET_ONE_SIDED: "行情一边倒，暂不可成交",
  INSUFFICIENT_BALANCE: "可用虚拟余额不足",
  BELOW_MIN_BET: "单笔下单金额低于最小值",
  INVALID_STAKE: "请输入有效的金额",
  RATE_LIMITED: "操作过于频繁，请稍后再试",
  DUPLICATE_REQUEST: "请勿重复提交",
  INVALID_SIDE: "方向无效",
  NOTHING_TO_HEDGE: "当前没有可对冲的仓位",
  ROUND_NOT_SETTLED: "本轮尚未完成结算",
};

export class EngineError extends Error {
  readonly code: ErrorCodeType;
  readonly details?: Record<string, unknown>;

  constructor(code: ErrorCodeType, details?: Record<string, unknown>) {
    super(USER_FACING_MESSAGE[code] ?? code);
    this.name = "EngineError";
    this.code = code;
    this.details = details;
  }
}
