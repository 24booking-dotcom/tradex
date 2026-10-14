// @vitest-environment node
import { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";
import { analyze } from "@/lib/chronos";
import type { Candle } from "@/lib/chronos";
import { loadHistory, persistSignals, type Db } from "@/lib/store";

// Deterministic synthetic candles: a TEST FIXTURE for exercising the SQL, not market data.
function fixture(n: number): Candle[] {
  let s = 11; const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  let p = 100, t = 1_700_000_000;
  return Array.from({ length: n }, (_, i) => {
    const o = p, reg = 0.3 + Math.abs(Math.sin(i / 25)) * 2; p = o * (1 + (rnd() - 0.5) * 0.01 * reg);
    return { time: (t += 900), open: o, high: Math.max(o, p) * 1.002, low: Math.min(o, p) * 0.998, close: p, volume: 50 + rnd() * 100 * reg };
  });
}

describe("signal persistence (real Postgres semantics via PGlite)", () => {
  let db: Db;
  beforeAll(() => {
    const pg = new PGlite();
    db = { query: async (t, p) => (await pg.query(t, p as unknown[])).rows as Record<string, unknown>[] };
  });
  const candles = fixture(600);
  const NOW = candles.at(-1)!.time + 10_000; // every candle closed

  it("stores signals with TP/SL and outcomes, and loads them newest first", async () => {
    const expected = analyze(candles).signals.length;
    expect(expected).toBeGreaterThan(5);
    expect(await persistSignals(db, "BTC", "15m", candles, NOW)).toBe(expected);
    const h = await loadHistory(db, "BTC", "15m");
    expect(h).toHaveLength(expected);
    expect(h[0]!.time).toBeGreaterThan(h.at(-1)!.time);
    expect(h.some((r) => r.reason === "TP" || r.reason === "SL")).toBe(true);
    expect(h.every((r) => typeof r.tp === "number" && typeof r.sl === "number")).toBe(true);
  });

  it("is idempotent and keeps the first recorded outcome", async () => {
    const before = await loadHistory(db, "BTC", "15m");
    await persistSignals(db, "BTC", "15m", candles, NOW);
    expect(await loadHistory(db, "BTC", "15m")).toEqual(before);
  });

  it("ignores the still-forming last candle", async () => {
    const last = candles.at(-1)!;
    const n = await persistSignals(db, "ETH", "15m", candles, last.time + 1); // last candle not closed yet
    const rows = await loadHistory(db, "ETH", "15m");
    expect(rows).toHaveLength(n);
    expect(rows.every((r) => r.time < last.time)).toBe(true);
  });

  it("keeps markets and intervals separate", async () => {
    expect(await loadHistory(db, "BTC", "1h")).toHaveLength(0);
  });
});
