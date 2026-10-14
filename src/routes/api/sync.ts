import { createFileRoute } from "@tanstack/react-router";
import { fetchCandles, SEC } from "@/lib/providers";
import { sendPendingAlerts } from "@/lib/alerts";
import { getDb, persistSignals } from "@/lib/store";
import { SYMBOLS } from "@/lib/symbols";

// Records signals for every market without anyone having the app open (called by Vercel Cron).
// If CRON_SECRET is set, Vercel sends it as "Authorization: Bearer <secret>" and we require it.
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });

export const Route = createFileRoute("/api/sync")({
  server: {
    handlers: {
      GET: async ({ request }: { request: Request }) => {
        const secret = process.env["CRON_SECRET"];
        if (secret && request.headers.get("authorization") !== `Bearer ${secret}`) return json({ error: "unauthorized" }, 401);
        const db = await getDb();
        if (!db) return json({ error: "DATABASE_URL is not configured" }, 503);
        const wanted = (new URL(request.url).searchParams.get("intervals") ?? "5m,15m,1h,4h").split(",").filter((i) => i in SEC);
        const report: Record<string, string> = {};
        await Promise.all(
          Object.entries(SYMBOLS).flatMap(([id, m]) =>
            wanted.map(async (iv) => {
              try {
                const { candles } = await fetchCandles(m.kind, m.symbol, iv);
                report[`${id}:${iv}`] = `${await persistSignals(db, id, iv, candles)} signals`;
              } catch (e) { report[`${id}:${iv}`] = `error: ${e instanceof Error ? e.message : String(e)}`; }
            }),
          ),
        );
        const alerts = await sendPendingAlerts(db);
        return json({ ...report, alerts });
      },
    },
  },
});
