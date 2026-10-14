import { createFileRoute } from "@tanstack/react-router";
import { fetchCandles } from "@/lib/providers";

// Server-side proxy: avoids browser CORS/geo-blocks and keeps provider logic in one place.
const SYMBOLS: Record<string, { kind: "crypto" | "index"; symbol: string }> = {
  BTC: { kind: "crypto", symbol: "BTCUSDT" },
  ETH: { kind: "crypto", symbol: "ETHUSDT" },
  XRP: { kind: "crypto", symbol: "XRPUSDT" },
  BNB: { kind: "crypto", symbol: "BNBUSDT" },
  US30: { kind: "index", symbol: "YM=F" },
  NAS100: { kind: "index", symbol: "NQ=F" },
  SPX: { kind: "index", symbol: "ES=F" },
  RUT: { kind: "index", symbol: "RTY=F" },
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": status === 200 ? "public, s-maxage=10, stale-while-revalidate=20" : "no-store" },
  });

export const Route = createFileRoute("/api/candles")({
  server: {
    handlers: {
      GET: async ({ request }: { request: Request }) => {
        const u = new URL(request.url);
        const m = SYMBOLS[u.searchParams.get("market") ?? ""];
        if (!m) return json({ error: "unknown market" }, 400);
        try {
          return json(await fetchCandles(m.kind, m.symbol, u.searchParams.get("interval") ?? "15m"));
        } catch (e) {
          return json({ error: e instanceof Error ? e.message : String(e) }, 502);
        }
      },
    },
  },
});
