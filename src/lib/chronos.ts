// Chronos-Alpha: squeeze (Bollinger/Keltner) + momentum + volume + post-midnight session filter.
export type Candle = { time: number; open: number; high: number; low: number; close: number; volume: number };
export type Signal = "BUY" | "SELL" | "LONG" | "SHORT" | "BULLZ" | "BEARZ";
export type SignalPoint = { time: number; signal: Signal; price: number; ratio: number; atr: number };

export const SIGNAL_TIER: Record<Signal, "scalp" | "moderate" | "massive"> = {
  BUY: "scalp", SELL: "scalp", LONG: "moderate", SHORT: "moderate", BULLZ: "massive", BEARZ: "massive",
};

/** True when the candle's local hour is in [0, sessionEnd) — the post-12 AM window. */
export function isPostMidnight(timeSec: number, sessionEnd: number, tzOffsetMin: number): boolean {
  const h = Math.floor((((timeSec / 60 - tzOffsetMin) % 1440) + 1440) % 1440 / 60);
  return h >= 0 && h < sessionEnd;
}

export function analyze(c: Candle[], len = 20, cooldown = 5) {
  const out: SignalPoint[] = [];
  const ratios: number[] = [];
  const mom: number[] = [];
  let last = -Infinity;
  let ema = c[0]?.close ?? 0; const k = 2 / 51; // trend filter EMA50
  for (let i = 0; i < c.length; i++) {
    ema = c[i]!.close * k + ema * (1 - k);
    if (i < len) { ratios.push(NaN); mom.push(0); continue; }
    const w = c.slice(i - len + 1, i + 1);
    const closes = w.map((x) => x.close);
    const sma = closes.reduce((a, b) => a + b, 0) / len;
    const dev = Math.sqrt(closes.reduce((a, b) => a + (b - sma) ** 2, 0) / len);
    const atr = w.reduce((a, x, k) => {
      const pc = k ? w[k - 1]!.close : x.open;
      return a + Math.max(x.high - x.low, Math.abs(x.high - pc), Math.abs(x.low - pc));
    }, 0) / len;
    const ratio = atr > 0 ? (4 * dev) / (3 * atr) : 1; // BB(2σ) width / KC(1.5 ATR) width
    // LazyBear-style momentum: linreg slope of close - midline
    const hi = Math.max(...w.map((x) => x.high)), lo = Math.min(...w.map((x) => x.low));
    const ys = closes.map((v) => v - ((hi + lo) / 2 + sma) / 2);
    const xm = (len - 1) / 2, ym = ys.reduce((a, b) => a + b, 0) / len;
    let num = 0, den = 0;
    ys.forEach((y, x) => { num += (x - xm) * (y - ym); den += (x - xm) ** 2; });
    const m = ym + (num / den) * xm;
    ratios.push(ratio); mom.push(m);
    const volAvg = w.reduce((a, x) => a + x.volume, 0) / len;
    const vol = c[i]!.volume, px = c[i]!.close, pm = mom[i - 1]!;
    const wasSqueezed = ratios.slice(-6, -1).filter((r) => r < 1).length >= 3;
    let s: Signal | null = null;
    if (wasSqueezed && ratio >= 1 && vol > volAvg * 1.2) s = m > 0 ? "BULLZ" : "BEARZ";
    else if (ratio >= 1 && ratio < 1.5 && vol >= volAvg) {
      if (px > sma + dev * 0.5 && px > ema && m > 0 && m > pm) s = "LONG";
      else if (px < sma - dev * 0.5 && px < ema && m < 0 && m < pm) s = "SHORT";
    } else if (ratio >= 1.5) {
      if (c[i]!.low <= sma - 2 * dev && m > pm) s = "BUY";
      else if (c[i]!.high >= sma + 2 * dev && m < pm) s = "SELL";
    }
    if (s && i - last >= cooldown) { out.push({ time: c[i]!.time, signal: s, price: px, ratio, atr }); last = i; }
  }
  return { signals: out, ratios, momentum: mom };
}

export type Trade = { entry: SignalPoint; exitTime: number; exitPrice: number; pnlPct: number; reason: "TP" | "SL" | "FLIP"; sl: number; tp: number; tps: number[] };
const TP_MULT = { scalp: 1, moderate: 2, massive: 3 } as const;
export const SL_MULT = 1.5;
const isLong = (s: Signal) => s === "BUY" || s === "LONG" || s === "BULLZ";

/** Each signal opens a trade; it closes at TP (ATR x tier), SL (1.5 ATR) or when an opposite label flips it. */
export function backtest(c: Candle[], signals: SignalPoint[]): Trade[] {
  const trades: Trade[] = [];
  const idx = new Map(c.map((x, i) => [x.time, i]));
  for (let n = 0; n < signals.length; n++) {
    const e = signals[n]!; const long = isLong(e.signal);
    const tp = e.price + (long ? 1 : -1) * e.atr * TP_MULT[SIGNAL_TIER[e.signal]];
    const dir = long ? 1 : -1;
    const tps = [1, 2, 3, 4].map((k) => e.price + dir * e.atr * k * (TP_MULT[SIGNAL_TIER[e.signal]] / 2));
    const sl = e.price - (long ? 1 : -1) * e.atr * SL_MULT;
    const next = signals.slice(n + 1).find((s) => isLong(s.signal) !== long);
    let out: Trade | null = null;
    for (let i = (idx.get(e.time) ?? 0) + 1; i < c.length && !out; i++) {
      const b = c[i]!;
      if (long ? b.low <= sl : b.high >= sl) out = { entry: e, exitTime: b.time, exitPrice: sl, pnlPct: 0, reason: "SL", sl, tp, tps };
      else if (long ? b.high >= tp : b.low <= tp) out = { entry: e, exitTime: b.time, exitPrice: tp, pnlPct: 0, reason: "TP", sl, tp, tps };
      else if (next && b.time >= next.time) out = { entry: e, exitTime: b.time, exitPrice: b.close, pnlPct: 0, reason: "FLIP", sl, tp, tps };
    }
    if (out) { out.pnlPct = ((out.exitPrice - e.price) / e.price) * 100 * (long ? 1 : -1); trades.push(out); }
  }
  return trades;
}

/** HWR (high win-rate): drop scalp labels, keep moderate/massive only. */
export const hwrFilter = (s: SignalPoint[]) => s.filter((p) => SIGNAL_TIER[p.signal] !== "scalp");

// ---------- Statistics ----------
export function candleStats(c: Candle[]) {
  if (c.length === 0) return null;
  const first = c[0]!, last = c.at(-1)!;
  const w = c.slice(-20);
  const atr = w.reduce((a, x, k) => {
    const pc = k ? w[k - 1]!.close : x.open;
    return a + Math.max(x.high - x.low, Math.abs(x.high - pc), Math.abs(x.low - pc));
  }, 0) / w.length;
  return {
    last: last.close,
    changePct: ((last.close - first.open) / first.open) * 100,
    high: Math.max(...c.map((x) => x.high)),
    low: Math.min(...c.map((x) => x.low)),
    atr,
    atrPct: (atr / last.close) * 100,
    avgVolume: c.reduce((a, x) => a + x.volume, 0) / c.length,
    up: c.filter((x) => x.close >= x.open).length,
    down: c.filter((x) => x.close < x.open).length,
  };
}

export type GroupStats = { n: number; wins: number; winRate: number; avgPnl: number; total: number; best: number; worst: number };
const group = (t: Trade[]): GroupStats => {
  const p = t.map((x) => x.pnlPct);
  const wins = p.filter((x) => x > 0).length;
  const total = p.reduce((a, b) => a + b, 0);
  return { n: t.length, wins, winRate: t.length ? (wins / t.length) * 100 : 0, avgPnl: t.length ? total / t.length : 0, total, best: t.length ? Math.max(...p) : 0, worst: t.length ? Math.min(...p) : 0 };
};

/** Overall + per-signal trade stats, plus max drawdown of the cumulative P&L curve (in % points). */
export function tradeStats(trades: Trade[]) {
  const bySignal = (Object.keys(SIGNAL_TIER) as Signal[])
    .map((s) => ({ signal: s, ...group(trades.filter((t) => t.entry.signal === s)) }))
    .filter((g) => g.n > 0);
  let eq = 0, peak = 0, maxDd = 0;
  for (const t of [...trades].sort((a, b) => a.exitTime - b.exitTime)) {
    eq += t.pnlPct; peak = Math.max(peak, eq); maxDd = Math.max(maxDd, peak - eq);
  }
  return { all: group(trades), bySignal, maxDrawdown: maxDd };
}

export type HistoryRow = { point: SignalPoint; trade: Trade | null };
/** Every signal with its outcome; `trade` is null while the signal has not hit TP/SL/flip yet. */
export function signalHistory(signals: SignalPoint[], trades: Trade[]): HistoryRow[] {
  const byEntry = new Map(trades.map((t) => [t.entry.time, t]));
  return signals.map((point) => ({ point, trade: byEntry.get(point.time) ?? null })).reverse();
}
