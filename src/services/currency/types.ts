export type RateSource = "nobitex";

/** نرخ لحظه‌ای دلار (تتر) به تومان */
export interface LiveExchangeRate {
  /** تومان برای هر دلار/تتر */
  rate: number;
  /** قیمت بر پایهٔ ریال (خروجی صرافی) */
  rialPerUsd: number;
  source: RateSource;
  updatedAt: Date;
}

export type RateFailureKind = "network" | "http" | "parse";

export interface RateFailure {
  kind: RateFailureKind;
  status?: number;
  message: string;
}