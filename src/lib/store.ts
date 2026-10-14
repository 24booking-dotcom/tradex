// Persistent signal history (Postgres). Optional: without DATABASE_URL the app still works,
// the history is then only the last ~500 candles computed on the fly.
import { analyze, backtest, SIGNAL_TIER, tradeLevels, type Candle, type Signal } from "./chronos";
import { sendPendingAlerts } from "./alerts";
import { SEC } from "./providers";

export type Db = { query(text: string, params?: unknown[]): Promise<Record<string, unknown>[]> };

const SCHEMA = `CREATE TABLE IF NOT EXISTS signals (
  market text NOT NULL, interval text NOT NULL, time bigint NOT NULL,
  signal text NOT NULL, price double precision NOT NULL, atr double precision NOT NULL, ratio double precision NOT NULL,
  tp double precision NOT NULL, sl double precision NOT NULL,
  exit_time bigint, exit_price double precision, reason text, pnl_pct double precision,
  created_at timestamptz NOT NULL DEFAULT now(),
  alerted_at timestamptz,
  PRIMARY KEY (market, interval, time)
)`;
const MIGRATE = `ALTER TABLE signals ADD COLUMN IF NOT EXISTS alerted_at timestamptz`;

let neonDb: Db | null | undefined;
const ready = new WeakMap<Db, Promise<unknown>>();

/** Neon/Vercel Postgres over HTTP. Returns null when DATABASE_URL is not configured. */
export async function getDb(): Promise<Db | null> {
  if (neonDb !== undefined) return neonDb;
  const url = process.env["DATABASE_URL"] ?? process.env["POSTGRES_URL"];
  if (!url) return (neonDb = null);
  const { neon } = await import("@neondatabase/serverless");
  const sql = neon(url);
  return (neonDb = { query: (t, p) => sql.query(t, p ?? []) as Promise<Record<string, unknown>[]> });
}

export function ensureSchema(db: Db) {
  let p = ready.get(db);
  if (!p) {
    p = (async () => {
      await db.query(SCHEMA);
      await db.query(MIGRATE); // tables created before alerts existed
    })();
    ready.set(db, p);
    p.catch(() => ready.delete(db)); // retry on the next call if setup failed
  }
  return p;
}

/** Signals + outcomes computed on CLOSED candles only, so a forming candle never writes an unstable signal. */
export async function persistSignals(db: Db, market: string, interval: string, candles: Candle[], nowSec = Date.now() / 1000) {
  const step = SEC[interval] ?? 900;
  const closed = candles.filter((c) => c.time + step <= nowSec);
  if (closed.length < 60) return 0;
  const { signals } = analyze(closed);
  if (signals.length === 0) return 0;
  const trades = new Map(backtest(closed, signals).map((t) => [t.entry.time, t]));
  const col = <T,>(f: (i: number) => T) => signals.map((_, i) => f(i));
  const lv = signals.map(tradeLevels);
  await ensureSchema(db);
  // A trade's outcome is final once closed, so COALESCE keeps the first recorded exit.
  await db.query(
    `INSERT INTO signals (market, interval, time, signal, price, atr, ratio, tp, sl, exit_time, exit_price, reason, pnl_pct)
     SELECT $1, $2, * FROM unnest($3::bigint[], $4::text[], $5::float8[], $6::float8[], $7::float8[], $8::float8[], $9::float8[], $10::bigint[], $11::float8[], $12::text[], $13::float8[])
     ON CONFLICT (market, interval, time) DO UPDATE SET
       exit_time = COALESCE(signals.exit_time, EXCLUDED.exit_time),
       exit_price = COALESCE(signals.exit_price, EXCLUDED.exit_price),
       reason = COALESCE(signals.reason, EXCLUDED.reason),
       pnl_pct = COALESCE(signals.pnl_pct, EXCLUDED.pnl_pct)`,
    [
      market, interval,
      col((i) => signals[i]!.time), col((i) => signals[i]!.signal), col((i) => signals[i]!.price),
      col((i) => signals[i]!.atr), col((i) => signals[i]!.ratio), col((i) => lv[i]!.tp), col((i) => lv[i]!.sl),
      col((i) => trades.get(signals[i]!.time)?.exitTime ?? null), col((i) => trades.get(signals[i]!.time)?.exitPrice ?? null),
      col((i) => trades.get(signals[i]!.time)?.reason ?? null), col((i) => trades.get(signals[i]!.time)?.pnlPct ?? null),
    ],
  );
  return signals.length;
}

export type StoredSignal = {
  time: number; signal: Signal; price: number; atr: number; ratio: number; tp: number; sl: number;
  exitTime: number | null; exitPrice: number | null; reason: "TP" | "SL" | "FLIP" | null; pnlPct: number | null; tier: string;
};

export async function loadHistory(db: Db, market: string, interval: string, limit = 1000): Promise<StoredSignal[]> {
  await ensureSchema(db);
  type Row = { time: unknown; signal: Signal; price: unknown; atr: unknown; ratio: unknown; tp: unknown; sl: unknown; exit_time: unknown; exit_price: unknown; reason: string | null; pnl_pct: unknown };
  const rows = (await db.query(`SELECT * FROM signals WHERE market = $1 AND interval = $2 ORDER BY time DESC LIMIT $3`, [market, interval, limit])) as Row[];
  const n = (v: unknown) => (v == null ? null : Number(v));
  return rows.map((r) => ({
    time: Number(r.time), signal: r.signal, price: Number(r.price), atr: Number(r.atr), ratio: Number(r.ratio),
    tp: Number(r.tp), sl: Number(r.sl), exitTime: n(r.exit_time), exitPrice: n(r.exit_price),
    reason: (r.reason as StoredSignal["reason"]) ?? null, pnlPct: n(r.pnl_pct), tier: SIGNAL_TIER[r.signal],
  }));
}

// Throttle: the UI polls every 15 s; one write per market/interval per minute per instance is plenty.
const lastWrite = new Map<string, number>();
export async function persistThrottled(market: string, interval: string, candles: Candle[]) {
  const key = `${market}:${interval}`;
  if (Date.now() - (lastWrite.get(key) ?? 0) < 60_000) return;
  const db = await getDb();
  if (!db) return;
  lastWrite.set(key, Date.now());
  try {
    await persistSignals(db, market, interval, candles);
    await sendPendingAlerts(db);
  }
  catch (e) { lastWrite.delete(key); console.error("persistSignals failed", e); }
}
