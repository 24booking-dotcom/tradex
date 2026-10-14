import { describe, expect, it } from "vitest";
import { aggregate, parseBinance, parseCryptoCom, parseYahoo } from "@/lib/providers";

describe("real-data provider parsers", () => {
  it("parses Binance klines", () => {
    const [c] = parseBinance([[1700000000000, "100", "110", "90", "105", "12.5", 0]]);
    expect(c).toEqual({ time: 1700000000, open: 100, high: 110, low: 90, close: 105, volume: 12.5 });
  });
  it("parses Crypto.com REST and sorts ascending", () => {
    const c = parseCryptoCom({ result: { data: [
      { o: "2", h: "3", l: "1", c: "2.5", v: "7", t: 1700000900000 },
      { o: "1", h: "2", l: "0.5", c: "1.5", v: "5", t: 1700000000000 },
    ] } });
    expect(c.map((x) => x.time)).toEqual([1700000000, 1700000900]);
    expect(c[1]!.close).toBe(2.5);
  });
  it("parses Crypto.com MCP-style rows", () => {
    const c = parseCryptoCom({ data: [{ open: "1", high: "2", low: "0.5", close: "1.5", volume: "5", timestamp: "2026-10-14T18:45:00Z" }] });
    expect(c[0]!.time).toBe(Date.parse("2026-10-14T18:45:00Z") / 1000);
  });
  it("parses Yahoo and skips null gaps", () => {
    const c = parseYahoo({ chart: { result: [{ timestamp: [1, 2, 3], indicators: { quote: [{
      open: [1, null, 3], high: [2, null, 4], low: [0, null, 2], close: [1.5, null, 3.5], volume: [10, null, 30] }] } }] } });
    expect(c).toHaveLength(2);
    expect(c[1]!.volume).toBe(30);
  });
  it("throws on provider errors instead of inventing data", () => {
    expect(() => parseYahoo({ chart: { result: null, error: { description: "No data" } } })).toThrow(/No data/);
    expect(() => parseBinance({ code: -1121 })).toThrow();
  });
  it("aggregates 1h into 4h buckets", () => {
    const h = 3600, base = 4 * h * 1000;
    const c = Array.from({ length: 8 }, (_, i) => ({ time: base + i * h, open: i, high: i + 1, low: i - 1, close: i + 0.5, volume: 1 }));
    const a = aggregate(c, 4 * h);
    expect(a).toHaveLength(2);
    expect(a[0]).toMatchObject({ open: 0, high: 4, low: -1, close: 3.5, volume: 4 });
  });
});
