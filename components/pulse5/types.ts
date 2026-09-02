export type Side = "up" | "down";

export type PricePoint = {
  time: number;
  price: number;
};

export type Ticker = {
  price: number;
  change: number;
  high: number;
  low: number;
  volume: number;
  quoteVolume: number;
};

export type ActiveBet = {
  id: number;
  start: number;
  end: number;
  side: Side;
  stake: number;
  open: number;
};

export type GameRecord = ActiveBet & {
  close: number;
  result: "win" | "loss" | "tie";
  pnl: number;
};
