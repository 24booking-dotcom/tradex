import { describe, it, expect } from "vitest";
import { isPostMidnight } from "@/lib/chronos";

describe("post-12 AM session", () => {
  it("00:30 UTC is inside a 0-8 window", () => expect(isPostMidnight(Date.UTC(2026, 0, 1, 0, 30) / 1000, 8, 0)).toBe(true));
  it("09:00 UTC is outside", () => expect(isPostMidnight(Date.UTC(2026, 0, 1, 9) / 1000, 8, 0)).toBe(false));
  it("respects Chicago offset (05:30 UTC = 00:30 CDT)", () =>
    expect(isPostMidnight(Date.UTC(2026, 6, 1, 5, 30) / 1000, 8, 300)).toBe(true));
});
