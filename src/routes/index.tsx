import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { analyze, backtest, candleStats, hwrFilter, isPostMidnight, signalHistory, SIGNAL_TIER, tradeStats, type Signal } from "@/lib/chronos";
import { INTERVALS, MARKETS, loadCandles, type CandleData } from "@/lib/markets";

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
  const [data, setData] = useState<CandleData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let on = true;
    setData(null); setError(null);
    const run = () => loadCandles(market, interval)
      .then((d) => { if (on) { setData(d); setError(null); } })
      .catch((e: Error) => { if (on) setError(e.message); });
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
  const ts = useMemo(() => tradeStats(trades), [trades]);
  const cs = useMemo(() => (data ? candleStats(data.candles) : null), [data]);
  const history = useMemo(() => signalHistory(result?.signals ?? [], trades), [result, trades]);
  const recent = history.slice(0, 8);
  const fmt = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: n < 10 ? 4 : 2 });
  const pct = (n: number) => `${n >= 0 ? "+" : ""}${n.toFixed(2)}%`;
  const tone = (n: number) => (n >= 0 ? "text-bull" : "text-bear");
  const when = (t: number) => new Date(t * 1000).toLocaleString("es", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });

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
            <span>{market.label}{market.note ? ` (${market.note})` : ""} · {interval}</span>
            <span className={error ? "text-bear" : "text-bull"}>
              {error ? "● SIN CONEXIÓN" : data ? `● DATOS REALES · ${data.source}` : "cargando…"}
            </span>
          </div>
          {error && <p className="border-b border-border px-4 py-2 font-mono text-xs text-bear">No se pudo obtener datos reales: {error}. Reintentando…</p>}
          <div ref={box} className="h-[520px]" />
        </section>

        <aside className="space-y-4">
          <div className="rounded-lg border border-border bg-card p-4 space-y-2">
            <h2 className="font-mono text-xs text-muted-foreground">RÉGIMEN</h2>
            <p className="font-semibold">{regime}</p>
            <p className="font-mono text-xs text-muted-foreground">S(t) = {isNaN(lastRatio) ? "—" : lastRatio.toFixed(2)} · Mom {lastMom > 0 ? "▲" : "▼"}</p>
          </div>
          <div className="rounded-lg border border-border bg-card p-4">
            <h2 className="mb-2 font-mono text-xs text-muted-foreground">ESTADÍSTICAS DE VELAS</h2>
            {cs ? (
              <dl className="grid grid-cols-2 gap-y-1 font-mono text-xs">
                <dt className="text-muted-foreground">Último</dt><dd className="text-right">{fmt(cs.last)}</dd>
                <dt className="text-muted-foreground">Variación</dt><dd className={`text-right ${tone(cs.changePct)}`}>{pct(cs.changePct)}</dd>
                <dt className="text-muted-foreground">Máximo</dt><dd className="text-right">{fmt(cs.high)}</dd>
                <dt className="text-muted-foreground">Mínimo</dt><dd className="text-right">{fmt(cs.low)}</dd>
                <dt className="text-muted-foreground">ATR (20)</dt><dd className="text-right">{fmt(cs.atr)} · {cs.atrPct.toFixed(2)}%</dd>
                <dt className="text-muted-foreground">Vol. prom.</dt><dd className="text-right">{fmt(cs.avgVolume)}</dd>
                <dt className="text-muted-foreground">Alcistas</dt><dd className="text-right text-bull">{cs.up} ({((cs.up / (cs.up + cs.down)) * 100).toFixed(0)}%)</dd>
                <dt className="text-muted-foreground">Bajistas</dt><dd className="text-right text-bear">{cs.down}</dd>
                <dt className="text-muted-foreground">Velas</dt><dd className="text-right">{data?.candles.length}</dd>
              </dl>
            ) : <p className="text-sm text-muted-foreground">Sin datos.</p>}
          </div>
          <div className="rounded-lg border border-border bg-card p-4">
            <h2 className="mb-2 font-mono text-xs text-muted-foreground">BACKTEST</h2>
            <dl className="grid grid-cols-2 gap-y-1 font-mono text-xs">
              <dt className="text-muted-foreground">Operaciones</dt><dd className="text-right">{ts.all.n}</dd>
              <dt className="text-muted-foreground">Acierto</dt><dd className="text-right">{ts.all.winRate.toFixed(0)}%</dd>
              <dt className="text-muted-foreground">Resultado</dt><dd className={`text-right ${tone(ts.all.total)}`}>{pct(ts.all.total)}</dd>
              <dt className="text-muted-foreground">Prom. / op.</dt><dd className={`text-right ${tone(ts.all.avgPnl)}`}>{pct(ts.all.avgPnl)}</dd>
              <dt className="text-muted-foreground">Mejor</dt><dd className="text-right text-bull">{pct(ts.all.best)}</dd>
              <dt className="text-muted-foreground">Peor</dt><dd className="text-right text-bear">{pct(ts.all.worst)}</dd>
              <dt className="text-muted-foreground">Drawdown máx.</dt><dd className="text-right text-bear">-{ts.maxDrawdown.toFixed(2)}%</dd>
            </dl>
            {ts.bySignal.length > 0 && (
              <table className="mt-3 w-full font-mono text-xs">
                <thead className="text-muted-foreground"><tr><th className="text-left font-normal">Señal</th><th className="text-right font-normal">Ops</th><th className="text-right font-normal">Acierto</th><th className="text-right font-normal">Total</th></tr></thead>
                <tbody>
                  {ts.bySignal.map((g) => (
                    <tr key={g.signal}>
                      <td className={ABOVE.includes(g.signal) ? "text-bear" : "text-bull"}>{g.signal}</td>
                      <td className="text-right">{g.n}</td>
                      <td className="text-right">{g.winRate.toFixed(0)}%</td>
                      <td className={`text-right ${tone(g.total)}`}>{pct(g.total)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
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
              {recent.map(({ point: s }) => (
                <li key={s.time} className="flex justify-between">
                  <span className={ABOVE.includes(s.signal) ? "text-bear font-semibold" : "text-bull font-semibold"}>{s.signal}</span>
                  <span className="text-muted-foreground">{when(s.time)}</span>
                  <span>{fmt(s.price)}</span>
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

      <section className="rounded-lg border border-border bg-card">
        <div className="flex items-center justify-between border-b border-border px-4 py-2 font-mono text-xs">
          <h2>HISTORIAL DE SEÑALES · {market.id} · {interval}</h2>
          <span className="text-muted-foreground">{history.length} señales</span>
        </div>
        <div className="max-h-96 overflow-auto">
          <table className="w-full font-mono text-xs">
            <thead className="sticky top-0 bg-card text-muted-foreground">
              <tr className="text-left">
                {["Fecha", "Señal", "Nivel", "Entrada", "TP", "SL", "Salida", "Motivo", "Resultado"].map((h) => <th key={h} className="px-3 py-2 font-normal">{h}</th>)}
              </tr>
            </thead>
            <tbody>
              {history.length === 0 && <tr><td colSpan={9} className="px-3 py-4 text-muted-foreground">Sin señales en este periodo.</td></tr>}
              {history.map(({ point: p, trade: t }) => (
                <tr key={p.time} className="border-t border-border">
                  <td className="px-3 py-1.5 text-muted-foreground">{when(p.time)}</td>
                  <td className={`px-3 py-1.5 font-semibold ${ABOVE.includes(p.signal) ? "text-bear" : "text-bull"}`}>{p.signal}</td>
                  <td className="px-3 py-1.5">{SIGNAL_TIER[p.signal]}</td>
                  <td className="px-3 py-1.5">{fmt(p.price)}</td>
                  <td className="px-3 py-1.5">{t ? fmt(t.tp) : "—"}</td>
                  <td className="px-3 py-1.5">{t ? fmt(t.sl) : "—"}</td>
                  <td className="px-3 py-1.5">{t ? `${fmt(t.exitPrice)} · ${when(t.exitTime)}` : "—"}</td>
                  <td className="px-3 py-1.5">{t ? t.reason : "ABIERTA"}</td>
                  <td className={`px-3 py-1.5 ${t ? tone(t.pnlPct) : "text-muted-foreground"}`}>{t ? pct(t.pnlPct) : "en curso"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}
