// Market id -> data-provider symbol. Server-side only.
export const SYMBOLS: Record<string, { kind: "crypto" | "index"; symbol: string }> = {
  BTC: { kind: "crypto", symbol: "BTCUSDT" },
  ETH: { kind: "crypto", symbol: "ETHUSDT" },
  XRP: { kind: "crypto", symbol: "XRPUSDT" },
  BNB: { kind: "crypto", symbol: "BNBUSDT" },
  US30: { kind: "index", symbol: "YM=F" },
  NAS100: { kind: "index", symbol: "NQ=F" },
  SPX: { kind: "index", symbol: "ES=F" },
  RUT: { kind: "index", symbol: "RTY=F" },
  // Yahoo Finance symbols. Commodities are futures (real volume); forex pairs are spot (Yahoo reports no volume).
  XAU: { kind: "index", symbol: "GC=F" },
  WTI: { kind: "index", symbol: "CL=F" },
  BRENT: { kind: "index", symbol: "BZ=F" },
  EURUSD: { kind: "index", symbol: "EURUSD=X" },
  GBPUSD: { kind: "index", symbol: "GBPUSD=X" },
  USDJPY: { kind: "index", symbol: "JPY=X" },
};
