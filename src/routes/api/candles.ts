import { createFileRoute } from "@tanstack/react-router";
import { fetchCandles } from "@/lib/providers";
import { persistThrottled } from "@/lib/store";
import { SYMBOLS } from "@/lib/symbols";

// Server-side proxy: avoids browser CORS/geo-blocks and keeps provider logic in one place.
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
          const interval = u.searchParams.get("interval") ?? "15m";
          const data = await fetchCandles(m.kind, m.symbol, interval);
          await persistThrottled(u.searchParams.get("market")!, interval, data.candles); // never throws
          return json(data);
        } catch (e) {
          return json({ error: e instanceof Error ? e.message : String(e) }, 502);
        }
      },
    },
  },
});
