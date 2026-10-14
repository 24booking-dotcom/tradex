// E-mail alerts for new signals, sent through Resend (https://resend.com). Optional: needs RESEND_API_KEY + ALERT_EMAIL_TO.
import { SIGNAL_TIER, type Signal } from "./chronos";
import { SEC } from "./providers";
import type { Db } from "./store";

type Tier = "scalp" | "moderate" | "massive";
const RANK: Record<Tier, number> = { scalp: 0, moderate: 1, massive: 2 };
const MAX_AGE_CANDLES = 3; // only alert while the signal is still actionable; older ones are just marked as seen

export type AlertConfig = { apiKey: string; to: string[]; from: string; minTier: Tier; appUrl: string | null };

export function alertConfig(env: Record<string, string | undefined> = process.env): AlertConfig | null {
  const apiKey = env["RESEND_API_KEY"], to = (env["ALERT_EMAIL_TO"] ?? "").split(",").map((x) => x.trim()).filter(Boolean);
  if (!apiKey || to.length === 0) return null;
  const tier = env["ALERT_MIN_TIER"] as Tier | undefined;
  const host = env["APP_URL"] ?? env["VERCEL_PROJECT_PRODUCTION_URL"];
  return {
    apiKey, to,
    from: env["ALERT_EMAIL_FROM"] ?? "Chronos-Alpha <onboarding@resend.dev>",
    minTier: tier && tier in RANK ? tier : "moderate",
    appUrl: host ? (host.startsWith("http") ? host : `https://${host}`) : null,
  };
}

export type PendingSignal = { market: string; interval: string; time: number; signal: Signal; price: number; tp: number; sl: number };

const n = (x: number) => x.toLocaleString("en-US", { maximumFractionDigits: x < 10 ? 5 : 2 });
const long = (s: Signal) => s === "BUY" || s === "LONG" || s === "BULLZ";

export function renderEmail(sigs: PendingSignal[], appUrl: string | null) {
  const subject = sigs.length === 1
    ? `Chronos-Alpha: ${sigs[0]!.signal} ${sigs[0]!.market} ${sigs[0]!.interval} @ ${n(sigs[0]!.price)}`
    : `Chronos-Alpha: ${sigs.length} señales nuevas`;
  const lines = sigs.map((s) =>
    `${long(s.signal) ? "▲" : "▼"} ${s.signal} (${SIGNAL_TIER[s.signal]}) · ${s.market} ${s.interval} · ${new Date(s.time * 1000).toISOString().replace("T", " ").slice(0, 16)} UTC\n   Entrada ${n(s.price)} · TP ${n(s.tp)} · SL ${n(s.sl)}`);
  const text = `${lines.join("\n\n")}\n\n${appUrl ? `Abrir terminal: ${appUrl}\n` : ""}No es asesoría financiera. El backtest no incluye comisiones ni deslizamiento.`;
  const html = `<div style="font-family:system-ui,sans-serif;max-width:520px">${sigs.map((s) =>
    `<p style="margin:0 0 14px"><b style="color:${long(s.signal) ? "#b8860b" : "#7b2fbf"}">${long(s.signal) ? "▲" : "▼"} ${s.signal}</b> · ${s.market} ${s.interval} <span style="color:#888">(${SIGNAL_TIER[s.signal]})</span><br>Entrada <b>${n(s.price)}</b> · TP ${n(s.tp)} · SL ${n(s.sl)}</p>`).join("")}
    ${appUrl ? `<p><a href="${appUrl}">Abrir terminal</a></p>` : ""}<p style="color:#888;font-size:12px">No es asesoría financiera. El backtest no incluye comisiones ni deslizamiento.</p></div>`;
  return { subject, text, html };
}

export async function sendEmail(cfg: AlertConfig, msg: { subject: string; text: string; html: string }, fetchFn: typeof fetch = fetch) {
  const r = await fetchFn("https://api.resend.com/emails", {
    method: "POST",
    headers: { authorization: `Bearer ${cfg.apiKey}`, "content-type": "application/json" },
    body: JSON.stringify({ from: cfg.from, to: cfg.to, subject: msg.subject, text: msg.text, html: msg.html }),
    signal: AbortSignal.timeout(10000),
  });
  if (!r.ok) throw new Error(`Resend HTTP ${r.status}: ${(await r.text()).slice(0, 200)}`);
}

/**
 * Claims every not-yet-alerted signal atomically (so concurrent runs never double-send), e-mails the recent ones
 * that meet the minimum tier as ONE digest, and releases the claim if sending fails so the next run retries.
 * Without e-mail configuration nothing is claimed.
 */
export async function sendPendingAlerts(db: Db, opts: { cfg?: AlertConfig | null; fetchFn?: typeof fetch; nowSec?: number } = {}) {
  const cfg = opts.cfg === undefined ? alertConfig() : opts.cfg;
  if (!cfg) return { sent: 0 };
  const nowSec = opts.nowSec ?? Date.now() / 1000;
  const claimed = (await db.query(
    `UPDATE signals SET alerted_at = now() WHERE alerted_at IS NULL RETURNING market, interval, time, signal, price, tp, sl`,
  )) as { market: string; interval: string; time: unknown; signal: Signal; price: unknown; tp: unknown; sl: unknown }[];
  const rows: PendingSignal[] = claimed.map((r) => ({ market: r.market, interval: r.interval, time: Number(r.time), signal: r.signal, price: Number(r.price), tp: Number(r.tp), sl: Number(r.sl) }));
  const send = rows
    .filter((r) => nowSec - r.time <= MAX_AGE_CANDLES * (SEC[r.interval] ?? 900) + (SEC[r.interval] ?? 900)) // candle close + 3 candles
    .filter((r) => RANK[SIGNAL_TIER[r.signal]] >= RANK[cfg.minTier])
    .sort((a, b) => a.time - b.time);
  if (send.length === 0) return { sent: 0 };
  try {
    await sendEmail(cfg, renderEmail(send, cfg.appUrl), opts.fetchFn);
    return { sent: send.length };
  } catch (e) {
    await db.query(`UPDATE signals SET alerted_at = NULL WHERE market || ':' || interval || ':' || time = ANY($1::text[])`, [rows.map((r) => `${r.market}:${r.interval}:${r.time}`)]);
    console.error("alert email failed", e);
    return { sent: 0, error: e instanceof Error ? e.message : String(e) };
  }
}
