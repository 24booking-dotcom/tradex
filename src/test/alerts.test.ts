// @vitest-environment node
import { PGlite } from "@electric-sql/pglite";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { alertConfig, renderEmail, sendPendingAlerts } from "@/lib/alerts";
import { ensureSchema, type Db } from "@/lib/store";

const NOW = 1_800_000_000;
const cfg = { apiKey: "k", to: ["a@b.c"], from: "x <x@y.z>", minTier: "moderate" as const, appUrl: "https://app.test" };

describe("e-mail alerts", () => {
  let db: Db;
  beforeEach(async () => {
    const pg = new PGlite();
    db = { query: async (t, p) => (await pg.query(t, p as unknown[])).rows as Record<string, unknown>[] };
    await ensureSchema(db);
  });
  const add = (market: string, interval: string, time: number, signal: string) =>
    db.query(`INSERT INTO signals (market, interval, time, signal, price, atr, ratio, tp, sl) VALUES ($1,$2,$3,$4,100,1,1,102,98)`, [market, interval, time, signal]);
  const pending = async () => (await db.query(`SELECT count(*)::int AS n FROM signals WHERE alerted_at IS NULL`))[0]!["n"];

  it("config is null without key/recipient and parses options", () => {
    expect(alertConfig({})).toBeNull();
    expect(alertConfig({ RESEND_API_KEY: "k" })).toBeNull();
    const c = alertConfig({ RESEND_API_KEY: "k", ALERT_EMAIL_TO: "a@b.c, d@e.f", ALERT_MIN_TIER: "massive", APP_URL: "app.test" })!;
    expect(c).toMatchObject({ to: ["a@b.c", "d@e.f"], minTier: "massive", appUrl: "https://app.test" });
  });

  it("sends ONE digest with only recent signals of the minimum tier, and marks everything as seen", async () => {
    await add("BTC", "15m", NOW - 900, "LONG"); // recent, moderate  -> sent
    await add("ETH", "15m", NOW - 1800, "BULLZ"); // recent, massive -> sent
    await add("XAU", "15m", NOW - 900, "BUY"); // recent but scalp (< moderate) -> skipped
    await add("SPX", "15m", NOW - 86_400, "SHORT"); // stale -> skipped
    const fetchFn = vi.fn(async () => new Response("{}", { status: 200 })) as unknown as typeof fetch;
    const r = await sendPendingAlerts(db, { cfg, fetchFn, nowSec: NOW });
    expect(r.sent).toBe(2);
    expect(fetchFn).toHaveBeenCalledTimes(1);
    const body = JSON.parse((fetchFn as unknown as { mock: { calls: [string, { body: string }][] } }).mock.calls[0]![1].body);
    expect(body.subject).toContain("2 señales");
    expect(body.text).toContain("BTC");
    expect(body.text).not.toContain("SPX");
    expect(await pending()).toBe(0);
    expect((await sendPendingAlerts(db, { cfg, fetchFn, nowSec: NOW })).sent).toBe(0); // no duplicates
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it("releases the claim when sending fails so the next run retries", async () => {
    await add("BTC", "15m", NOW - 900, "LONG");
    const bad = vi.fn(async () => new Response("nope", { status: 500 })) as unknown as typeof fetch;
    const r = await sendPendingAlerts(db, { cfg, fetchFn: bad, nowSec: NOW });
    expect(r.sent).toBe(0);
    expect(r).toHaveProperty("error");
    expect(await pending()).toBe(1);
    const ok = vi.fn(async () => new Response("{}", { status: 200 })) as unknown as typeof fetch;
    expect((await sendPendingAlerts(db, { cfg, fetchFn: ok, nowSec: NOW })).sent).toBe(1);
  });

  it("claims nothing when e-mail is not configured", async () => {
    await add("BTC", "15m", NOW - 900, "LONG");
    expect((await sendPendingAlerts(db, { cfg: null, nowSec: NOW })).sent).toBe(0);
    expect(await pending()).toBe(1);
  });

  it("renders a single-signal subject with levels", () => {
    const m = renderEmail([{ market: "BTC", interval: "15m", time: NOW, signal: "SHORT", price: 81234.5, tp: 80000, sl: 82000 }], null);
    expect(m.subject).toBe("Chronos-Alpha: SHORT BTC 15m @ 81,234.5");
    expect(m.text).toContain("TP 80,000");
  });
});
