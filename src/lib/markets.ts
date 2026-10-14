import type { Candle } from "./chronos";

export type Market = { id: string; label: string; binance?: string; base: number; vol: number };
export const MARKETS: Market[] = [
  { id: "BTC", label: "Bitcoin", binance: "BTCUSDT", base: 0, vol: 0 },
  { id: "ETH", label: "Ethereum", binance: "ETHUSDT", base: 0, vol: 0 },
  { id: "XRP", label: "XRP", binance: "XRPUSDT", base: 0, vol: 0 },
  { id: "BNB", label: "BNB", binance: "BNBUSDT", base: 0, vol: 0 },
  { id: "US30", label: "Dow Jones", base: 42000, vol: 0.0015 },
  { id: "NAS100", label: "Nasdaq 100", base: 20000, vol: 0.002 },
  { id: "SPX", label: "S&P 500", base: 5800, vol: 0.0016 },
  { id: "RUT", label: "Russell 2000", base: 2200, vol: 0.0022 },
];
export const INTERVALS = ["1m", "5m", "15m", "1h", "4h"] as const;
const SEC: Record<string, number> = { "1m": 60, "5m": 300, "15m": 900, "1h": 3600, "4h": 14400 };

export async function loadCandles(m: Market, interval: string): Promise<{ candles: Candle[]; live: boolean }> {
  if (m.binance) {
    try {
      const r = await fetch(`https://api.binance.com/api/v3/klines?symbol=${m.binance}&interval=${interval}&limit=500`);
      const d: string[][] = await r.json();
      return {
        live: true,
        candles: d.map((k) => ({ time: Number(k[0]) / 1000, open: +k[1]!, high: +k[2]!, low: +k[3]!, close: +k[4]!, volume: +k[5]! })),
      };
    } catch { /* fall through to simulation */ }
  }
  return { live: false, candles: simulate(m.base || 100, m.vol || 0.003, SEC[interval] ?? 900) };
}

function simulate(base: number, vol: number, step: number): Candle[] {
  let seed = Math.floor(base * 7) % 2147483647 || 1;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const now = Math.floor(Date.now() / 1000 / step) * step;
  let p = base, regime = 1;
  return Array.from({ length: 500 }, (_, i) => {
    if (rnd() < 0.03) regime = 0.3 + rnd() * 2.5;
    const o = p, ch = (rnd() - 0.5 + Math.sin(i / 40) * 0.08) * vol * regime * 2;
    p = o * (1 + ch);
    const hi = Math.max(o, p) * (1 + rnd() * vol * regime), lo = Math.min(o, p) * (1 - rnd() * vol * regime);
    return { time: now - (499 - i) * step, open: o, high: hi, low: lo, close: p, volume: 100 * regime * (0.5 + rnd()) };
  });
}
