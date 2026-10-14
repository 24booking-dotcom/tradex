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
};
