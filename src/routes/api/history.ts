import { createFileRoute } from "@tanstack/react-router";
import { SYMBOLS } from "@/lib/symbols";
import { getDb, loadHistory } from "@/lib/store";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });

export const Route = createFileRoute("/api/history")({
  server: {
    handlers: {
      GET: async ({ request }: { request: Request }) => {
        const u = new URL(request.url);
        const market = u.searchParams.get("market") ?? "";
        if (!SYMBOLS[market]) return json({ error: "unknown market" }, 400);
        const db = await getDb();
        if (!db) return json({ configured: false, rows: [] });
        try {
          return json({ configured: true, rows: await loadHistory(db, market, u.searchParams.get("interval") ?? "15m") });
        } catch (e) {
          return json({ configured: true, rows: [], error: e instanceof Error ? e.message : String(e) }, 500);
        }
      },
    },
  },
});
