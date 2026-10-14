import type { Candle } from "./chronos";
import type { StoredSignal } from "./store";

// Every market is served by real exchange / futures data through /api/candles. There is no simulation.
export type Market = { id: string; label: string; note?: string };
export const MARKETS: Market[] = [
  { id: "BTC", label: "Bitcoin" },
  { id: "ETH", label: "Ethereum" },
  { id: "XRP", label: "XRP" },
  { id: "BNB", label: "BNB" },
  { id: "US30", label: "Dow Jones", note: "Futuros YM" },
  { id: "NAS100", label: "Nasdaq 100", note: "Futuros NQ" },
  { id: "SPX", label: "S&P 500", note: "Futuros ES" },
  { id: "RUT", label: "Russell 2000", note: "Futuros RTY" },
  { id: "XAU", label: "Oro", note: "Futuros GC" },
  { id: "WTI", label: "Petróleo WTI", note: "Futuros CL" },
  { id: "BRENT", label: "Petróleo Brent", note: "Futuros BZ" },
  { id: "EURUSD", label: "EUR/USD", note: "Forex · sin volumen" },
  { id: "GBPUSD", label: "GBP/USD", note: "Forex · sin volumen" },
  { id: "USDJPY", label: "USD/JPY", note: "Forex · sin volumen" },
];
export const INTERVALS = ["1m", "5m", "15m", "1h", "4h"] as const;

export type CandleData = { candles: Candle[]; source: string };

export async function loadCandles(m: Market, interval: string): Promise<CandleData> {
  const r = await fetch(`/api/candles?market=${m.id}&interval=${interval}`);
  const body = (await r.json()) as CandleData & { error?: string };
  if (!r.ok) throw new Error(body.error ?? `HTTP ${r.status}`);
  return body;
}

export type StoredHistory = { configured: boolean; rows: StoredSignal[] };

export async function loadStoredHistory(marketId: string, interval: string): Promise<StoredHistory> {
  const r = await fetch(`/api/history?market=${marketId}&interval=${interval}`);
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return (await r.json()) as StoredHistory;
}
