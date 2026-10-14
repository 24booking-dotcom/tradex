import { describe, it, expect } from "vitest";
import { isPostMidnight } from "@/lib/chronos";

describe("post-12 AM session", () => {
  it("00:30 UTC is inside a 0-8 window", () => expect(isPostMidnight(Date.UTC(2026, 0, 1, 0, 30) / 1000, 8, 0)).toBe(true));
  it("09:00 UTC is outside", () => expect(isPostMidnight(Date.UTC(2026, 0, 1, 9) / 1000, 8, 0)).toBe(false));
  it("respects Chicago offset (05:30 UTC = 00:30 CDT)", () =>
    expect(isPostMidnight(Date.UTC(2026, 6, 1, 5, 30) / 1000, 8, 300)).toBe(true));
});

import { candleStats, tradeStats, signalHistory, type Trade, type SignalPoint } from "@/lib/chronos";

describe("statistics", () => {
  const mk = (time: number, signal: SignalPoint["signal"], pnl: number, exitTime: number): Trade => ({
    entry: { time, signal, price: 100, ratio: 1, atr: 1 }, exitTime, exitPrice: 100 + pnl, pnlPct: pnl, reason: pnl > 0 ? "TP" : "SL", sl: 98, tp: 102, tps: [],
  });
  it("candleStats", () => {
    const c = [
      { time: 1, open: 100, high: 110, low: 95, close: 105, volume: 10 },
      { time: 2, open: 105, high: 108, low: 90, close: 92, volume: 30 },
    ];
    const s = candleStats(c)!;
    expect(s).toMatchObject({ last: 92, high: 110, low: 90, avgVolume: 20, up: 1, down: 1 });
    expect(s.changePct).toBeCloseTo(-8);
  });
  it("tradeStats by signal and drawdown", () => {
    const t = [mk(1, "BUY", 3, 2), mk(3, "BUY", -2, 4), mk(5, "LONG", -4, 6), mk(7, "LONG", 5, 8)];
    const s = tradeStats(t);
    expect(s.all).toMatchObject({ n: 4, wins: 2, winRate: 50, total: 2, best: 5, worst: -4 });
    expect(s.bySignal.find((g) => g.signal === "BUY")).toMatchObject({ n: 2, winRate: 50, total: 1 });
    expect(s.maxDrawdown).toBe(6); // peak +3, trough -3
  });
  it("signalHistory newest first, open signals have no trade", () => {
    const t = mk(1, "BUY", 3, 2);
    const h = signalHistory([t.entry, { time: 9, signal: "SELL", price: 100, ratio: 1, atr: 1 }], [t]);
    expect(h.map((r) => r.point.time)).toEqual([9, 1]);
    expect(h[0]!.trade).toBeNull();
    expect(h[1]!.trade).toBe(t);
  });
});
