import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { analyze, backtest, hwrFilter, isPostMidnight, SIGNAL_TIER, type Candle, type Signal } from "@/lib/chronos";
import { INTERVALS, MARKETS, loadCandles } from "@/lib/markets";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Chronos-Alpha — Terminal de trading con señales" },
      { name: "description", content: "Velas que cambian de color después de las 12 AM y señales BUY/SELL, LONG/SHORT y BULLZ/BEARZ." },
      { property: "og:title", content: "Chronos-Alpha Trading Terminal" },
      { property: "og:description", content: "Squeeze, momentum y filtro de sesión post-medianoche para BTC, ETH, oro, petróleo e índices." },
    ],
  }),
  component: Index,
});

// Canvas chart needs literal colors; these mirror the tokens in styles.css.
const C = {
  bg: "#0f141b", grid: "#1b222c", text: "#8b95a5",
  up: "#f5d020", down: "#a646f0", nightUp: "#f59e6b", nightDown: "#ec6fd0",
  scalp: "#f5d020", moderate: "#f59e6b", massive: "#ffffff",
};
const ABOVE: Signal[] = ["SELL", "SHORT", "BEARZ"];

function Index() {
  const [market, setMarket] = useState(MARKETS[0]!);
  const [interval, setIv] = useState<string>("15m");
  const [sessionEnd, setSessionEnd] = useState(8);
  const [mode, setMode] = useState<"tpsl" | "hwr" | "buysell">("tpsl");
  const [alerts, setAlerts] = useState(false);
  const lastAlert = useRef<number>(0);
  const [data, setData] = useState<{ candles: Candle[]; live: boolean } | null>(null);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let on = true;
    const run = () => loadCandles(market, interval).then((d) => on && setData(d));
    run();
    const t = setInterval(run, 15000);
    return () => { on = false; clearInterval(t); };
  }, [market, interval]);

  const result = useMemo(() => {
    if (!data) return null;
    const r = analyze(data.candles);
    const signals = mode === "hwr" ? hwrFilter(r.signals) : r.signals;
    return { ...r, signals, trades: backtest(data.candles, signals) };
  }, [data, mode]);

  useEffect(() => {
    const last = result?.signals.at(-1);
    if (!last) return;
    if (lastAlert.current && last.time > lastAlert.current && alerts && "Notification" in window && Notification.permission === "granted")
      new Notification(`Chronos-Alpha: ${last.signal} ${market.id}`, { body: `Precio ${last.price.toFixed(2)}` });
    lastAlert.current = last.time;
  }, [result, alerts, market.id]);

  useEffect(() => {
    if (!box.current || !data || !result) return;
    let chart: { remove(): void } | null = null;
    const tz = new Date().getTimezoneOffset();
    import("lightweight-charts").then(({ createChart }) => {
      if (!box.current) return;
      const ch = createChart(box.current, {
        autoSize: true,
        localization: { locale: "es-ES" },
        layout: { background: { color: C.bg }, textColor: C.text, fontFamily: "JetBrains Mono" },
        grid: { vertLines: { color: C.grid }, horzLines: { color: C.grid } },
        timeScale: { timeVisible: true, borderColor: C.grid },
        rightPriceScale: { borderColor: C.grid },
      });
      chart = ch;
      const s = ch.addCandlestickSeries({ borderVisible: false, upColor: C.up, downColor: C.down });
      s.setData(data.candles.map((c) => {
        const night = isPostMidnight(c.time, sessionEnd, tz);
        const up = c.close >= c.open;
        const col = night ? (up ? C.nightUp : C.nightDown) : up ? C.up : C.down;
        return { time: c.time as never, open: c.open, high: c.high, low: c.low, close: c.close, color: col, wickColor: col };
      }));
      const marks = [
        ...result.signals.map((p) => {
          const above = ABOVE.includes(p.signal);
          return {
            time: p.time, text: p.signal, color: above ? C.down : C[SIGNAL_TIER[p.signal]],
            position: (above ? "aboveBar" : "belowBar") as "aboveBar", shape: (above ? "arrowDown" : "arrowUp") as "arrowUp",
          };
        }),
        ...result.trades.map((t) => ({
          time: t.exitTime, text: `Exit ${t.pnlPct >= 0 ? "+" : ""}${t.pnlPct.toFixed(2)}%`, color: t.pnlPct >= 0 ? C.up : C.down,
          position: "inBar" as "aboveBar", shape: "square" as "arrowUp",
        })),
      ].sort((a, b) => a.time - b.time);
      s.setMarkers(marks.map((m) => ({ ...m, time: m.time as never })));
      const open = result.trades.at(-1);
      if (open && mode === "tpsl") {
        open.tps.forEach((p, k) => s.createPriceLine({ price: p, color: C.up, lineStyle: 0, lineWidth: 1, title: `TP ${k + 1}` }));
        s.createPriceLine({ price: open.sl, color: C.down, lineStyle: 0, lineWidth: 2, title: "SL" });
      }
      const v = ch.addHistogramSeries({ priceScaleId: "vol", priceFormat: { type: "volume" } });
      ch.priceScale("vol").applyOptions({ scaleMargins: { top: 0.85, bottom: 0 } });
      v.setData(data.candles.map((c) => ({ time: c.time as never, value: c.volume, color: c.close >= c.open ? "#f5d02033" : "#a646f033" })));
    });
    return () => chart?.remove();
  }, [data, result, sessionEnd, mode]);

  const lastRatio = result?.ratios.at(-1) ?? NaN;
  const lastMom = result?.momentum.at(-1) ?? 0;
  const regime = isNaN(lastRatio) ? "—" : lastRatio < 1 ? "COMPRESIÓN (masivo en carga)" : lastRatio < 1.5 ? "TENDENCIA (moderado)" : "SOBREEXTENSIÓN (scalping)";
  const trades = result?.trades ?? [];
  const wins = trades.filter((t) => t.pnlPct > 0).length;
  const total = trades.reduce((a, t) => a + t.pnlPct, 0);
  const recent = result?.signals.slice(-8).reverse() ?? [];

  return (
    <main className="mx-auto max-w-7xl p-4 md:p-6 space-y-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="font-mono text-xs tracking-[0.3em] text-primary">EDGE · 2029</p>
          <h1 className="text-3xl font-bold">Chronos-Alpha</h1>
        </div>
        <div className="flex rounded-full border border-border p-1 text-sm">
          {([["tpsl", "TP & SL"], ["hwr", "HWR"], ["buysell", "Buy-Sell"]] as const).map(([k, l]) => (
            <button key={k} onClick={() => setMode(k)}
              className={`rounded-full px-4 py-1.5 font-semibold ${mode === k ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}>{l}</button>
          ))}
        </div>
        <button onClick={async () => { if ("Notification" in window) await Notification.requestPermission(); setAlerts((a) => !a); }}
          className={`rounded-full border px-4 py-2 text-sm ${alerts ? "border-primary text-primary" : "border-border text-muted-foreground"}`}>
          {alerts ? "🔔 Alertas activas" : "🔕 Activar alertas"}
        </button>
        <div className="flex flex-wrap gap-2 font-mono text-xs">
          {INTERVALS.map((i) => (
            <button key={i} onClick={() => setIv(i)}
              className={`rounded border px-3 py-1.5 ${i === interval ? "border-primary bg-primary text-primary-foreground" : "border-border text-muted-foreground hover:text-foreground"}`}>{i}</button>
          ))}
        </div>
      </header>

      <nav className="flex flex-wrap gap-2">
        {MARKETS.map((m) => (
          <button key={m.id} onClick={() => setMarket(m)}
            className={`rounded-md border px-3 py-2 text-sm ${m.id === market.id ? "border-primary text-primary bg-card" : "border-border text-muted-foreground hover:text-foreground"}`}>
            <span className="font-mono font-semibold">{m.id}</span> <span className="opacity-70">{m.label}</span>
          </button>
        ))}
      </nav>

      <div className="grid gap-4 lg:grid-cols-[1fr_280px]">
        <section className="rounded-lg border border-border bg-card overflow-hidden">
          <div className="flex items-center justify-between border-b border-border px-4 py-2 font-mono text-xs">
            <span>{market.label} · {interval}</span>
            <span className={data?.live ? "text-bull" : "text-accent"}>{data ? (data.live ? "● EN VIVO" : "● SIMULADO") : "cargando…"}</span>
          </div>
          <div ref={box} className="h-[520px]" />
        </section>

        <aside className="space-y-4">
          <div className="rounded-lg border border-border bg-card p-4 space-y-2">
            <h2 className="font-mono text-xs text-muted-foreground">RÉGIMEN</h2>
            <p className="font-semibold">{regime}</p>
            <p className="font-mono text-xs text-muted-foreground">S(t) = {isNaN(lastRatio) ? "—" : lastRatio.toFixed(2)} · Mom {lastMom > 0 ? "▲" : "▼"}</p>
          </div>
          <div className="rounded-lg border border-border bg-card p-4">
            <h2 className="mb-2 font-mono text-xs text-muted-foreground">BACKTEST</h2>
            <dl className="grid grid-cols-2 gap-y-1 font-mono text-xs">
              <dt className="text-muted-foreground">Operaciones</dt><dd className="text-right">{trades.length}</dd>
              <dt className="text-muted-foreground">Acierto</dt><dd className="text-right">{trades.length ? ((wins / trades.length) * 100).toFixed(0) : 0}%</dd>
              <dt className="text-muted-foreground">Resultado</dt><dd className={`text-right ${total >= 0 ? "text-bull" : "text-bear"}`}>{total >= 0 ? "+" : ""}{total.toFixed(2)}%</dd>
              <dt className="text-muted-foreground">Velas</dt><dd className="text-right">{data?.candles.length ?? 0}</dd>
            </dl>
          </div>
          <div className="rounded-lg border border-border bg-card p-4 space-y-3">
            <h2 className="font-mono text-xs text-muted-foreground">SESIÓN POST-12 AM</h2>
            <p className="text-sm">Velas en <span className="text-accent">coral</span>/<span className="text-chart-5">rosa</span> de 12:00 AM a {sessionEnd}:00 (tu hora local).</p>
            <input type="range" min={1} max={12} value={sessionEnd} onChange={(e) => setSessionEnd(+e.target.value)} className="w-full accent-primary" />
          </div>
          <div className="rounded-lg border border-border bg-card p-4">
            <h2 className="mb-2 font-mono text-xs text-muted-foreground">ÚLTIMAS SEÑALES</h2>
            {recent.length === 0 && <p className="text-sm text-muted-foreground">Sin señales.</p>}
            <ul className="space-y-1.5 font-mono text-xs">
              {recent.map((s) => (
                <li key={s.time} className="flex justify-between">
                  <span className={ABOVE.includes(s.signal) ? "text-bear font-semibold" : "text-bull font-semibold"}>{s.signal}</span>
                  <span className="text-muted-foreground">{new Date(s.time * 1000).toLocaleString("es", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })}</span>
                  <span>{s.price.toFixed(2)}</span>
                </li>
              ))}
            </ul>
          </div>
          <div className="rounded-lg border border-border p-4 text-xs text-muted-foreground space-y-1">
            <p><b className="text-foreground">BUY/SELL</b> scalping: toque de banda 2σ con giro de momentum.</p>
            <p><b className="text-chart-4">LONG/SHORT</b> moderado: tendencia (EMA50) + volumen.</p>
            <p><b className="text-accent">BULLZ/BEARZ</b> masivo: liberación de squeeze con volumen.</p>
            <p><b className="text-foreground">Exit</b>: TP por nivel (1/2/3 ATR), SL 1.5 ATR o giro de señal.</p>
            <p className="pt-2">No es asesoría financiera.</p>
          </div>
        </aside>
      </div>
    </main>
  );
}
