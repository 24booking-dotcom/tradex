// Real market-data providers. Server-side only (called from /api/candles).
// No simulated data: if every provider fails, the error propagates to the UI.
import type { Candle } from "./chronos";

export const SEC: Record<string, number> = { "1m": 60, "5m": 300, "15m": 900, "1h": 3600, "4h": 14400 };
const LIMIT = 500;
const UA = "Mozilla/5.0 (compatible; Chronos-Alpha/1.0)";

async function getJson(url: string): Promise<unknown> {
  const r = await fetch(url, { headers: { "user-agent": UA, accept: "application/json" }, signal: AbortSignal.timeout(8000) });
  if (!r.ok) throw new Error(`${new URL(url).host} -> HTTP ${r.status}`);
  return r.json();
}

// ---------- Crypto: Binance (global mirror, then US), then Crypto.com ----------
export function parseBinance(d: unknown): Candle[] {
  if (!Array.isArray(d)) throw new Error("binance: unexpected payload");
  return (d as (string | number)[][]).map((k) => ({
    time: Number(k[0]) / 1000, open: +k[1]!, high: +k[2]!, low: +k[3]!, close: +k[4]!, volume: +k[5]!,
  }));
}

type CdcRow = { o?: string; h?: string; l?: string; c?: string; v?: string; t?: number; open?: string; high?: string; low?: string; close?: string; volume?: string; timestamp?: string };
export function parseCryptoCom(d: unknown): Candle[] {
  const p = d as { result?: { data?: CdcRow[] }; data?: CdcRow[] };
  const rows = p?.result?.data ?? p?.data;
  if (!Array.isArray(rows)) throw new Error("crypto.com: unexpected payload");
  return rows
    .map((r) => ({
      time: r.t != null ? r.t / 1000 : Date.parse(r.timestamp ?? "") / 1000,
      open: +(r.o ?? r.open!), high: +(r.h ?? r.high!), low: +(r.l ?? r.low!), close: +(r.c ?? r.close!), volume: +(r.v ?? r.volume!),
    }))
    .sort((a, b) => a.time - b.time);
}

async function crypto(symbol: string, interval: string): Promise<{ candles: Candle[]; source: string }> {
  const errors: string[] = [];
  const binance = `/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=${LIMIT}`;
  for (const host of ["https://data-api.binance.vision", "https://api.binance.com", "https://api.binance.us"]) {
    try { return { candles: parseBinance(await getJson(host + binance)), source: new URL(host).host }; }
    catch (e) { errors.push(String(e)); }
  }
  try {
    const inst = symbol.replace(/USDT$/, "_USDT");
    const tf = interval === "1h" ? "1h" : interval; // crypto.com uses the same labels
    const j = await getJson(`https://api.crypto.com/exchange/v1/public/get-candlestick?instrument_name=${inst}&timeframe=${tf}&count=300`);
    return { candles: parseCryptoCom(j), source: "api.crypto.com" };
  } catch (e) { errors.push(String(e)); }
  throw new Error(`crypto providers failed: ${errors.join(" | ")}`);
}

// ---------- US indices: index futures (real volume, ~24h session) via Yahoo Finance ----------
type YQuote = { open?: (number | null)[]; high?: (number | null)[]; low?: (number | null)[]; close?: (number | null)[]; volume?: (number | null)[] };
export function parseYahoo(d: unknown): Candle[] {
  const r = (d as { chart?: { result?: { timestamp?: number[]; indicators?: { quote?: YQuote[] } }[]; error?: { description?: string } } })?.chart;
  const res = r?.result?.[0];
  const q = res?.indicators?.quote?.[0];
  if (!res?.timestamp || !q) throw new Error(`yahoo: ${r?.error?.description ?? "unexpected payload"}`);
  const out: Candle[] = [];
  res.timestamp.forEach((t, i) => {
    const o = q.open?.[i], h = q.high?.[i], l = q.low?.[i], c = q.close?.[i];
    if (o == null || h == null || l == null || c == null) return; // skip gaps
    out.push({ time: t, open: o, high: h, low: l, close: c, volume: q.volume?.[i] ?? 0 });
  });
  return out;
}

/** Yahoo has no 4h bars: build them from 1h bars, aligned to 4h UTC buckets. */
export function aggregate(c: Candle[], step: number): Candle[] {
  const out: Candle[] = [];
  for (const x of c) {
    const t = Math.floor(x.time / step) * step;
    const last = out.at(-1);
    if (last && last.time === t) {
      last.high = Math.max(last.high, x.high); last.low = Math.min(last.low, x.low);
      last.close = x.close; last.volume += x.volume;
    } else out.push({ ...x, time: t });
  }
  return out;
}

const YAHOO: Record<string, { iv: string; range: string }> = {
  "1m": { iv: "1m", range: "5d" }, "5m": { iv: "5m", range: "1mo" }, "15m": { iv: "15m", range: "1mo" },
  "1h": { iv: "60m", range: "6mo" }, "4h": { iv: "60m", range: "6mo" },
};

async function yahoo(symbol: string, interval: string): Promise<{ candles: Candle[]; source: string }> {
  const { iv, range } = YAHOO[interval] ?? YAHOO["15m"]!;
  const errors: string[] = [];
  for (const host of ["query1.finance.yahoo.com", "query2.finance.yahoo.com"]) {
    try {
      const j = await getJson(`https://${host}/v8/finance/chart/${encodeURIComponent(symbol)}?interval=${iv}&range=${range}&includePrePost=true`);
      let candles = parseYahoo(j);
      if (interval === "4h") candles = aggregate(candles, SEC["4h"]!);
      return { candles, source: "Yahoo Finance" };
    } catch (e) { errors.push(String(e)); }
  }
  throw new Error(`index providers failed: ${errors.join(" | ")}`);
}

export async function fetchCandles(kind: "crypto" | "index", symbol: string, interval: string) {
  if (!(interval in SEC)) throw new Error(`unsupported interval ${interval}`);
  const r = kind === "crypto" ? await crypto(symbol, interval) : await yahoo(symbol, interval);
  const candles = r.candles.filter((c) => [c.open, c.high, c.low, c.close].every(Number.isFinite)).slice(-LIMIT);
  if (candles.length < 60) throw new Error(`only ${candles.length} candles returned for ${symbol}`);
  return { candles, source: r.source };
}
