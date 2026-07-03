// Preço diário BTC/USD de fonte com histórico COMPLETO (fechamento diário), pra
// preencher as datas do backfill do genesis (jan–jul/2025) que caem FORA da janela
// de 365 dias da CoinGecko free usada pelo price.ts/seed-history. Fonte primária:
// Coinbase Exchange BTC-USD (USD real); fallback: Bitstamp BTC/USD. fetchImpl
// injetável → testável sem rede. Datas em UTC (batem com o dateOf do seed-history).
import type { HistoryRow } from './history';

export interface CloseOpts { fetchImpl?: typeof fetch; }

const DAY_MS = 86_400_000;
const dayOf = (unixSec: number): string => new Date(unixSec * 1000).toISOString().slice(0, 10);

/** Coinbase Exchange: candles [time(s), low, high, open, close, vol]; time = UTC 00:00
 *  do dia (buckets alinhados ao epoch). Máx 300 candles/req → fatia a janela.
 *  Devolve date(UTC YYYY-MM-DD) -> fechamento USD. */
export async function fetchCoinbaseDailyClose(fromIso: string, toIso: string, opts: CloseOpts = {}): Promise<Record<string, number>> {
  const f = opts.fetchImpl ?? fetch;
  const out: Record<string, number> = {};
  let start = Date.parse(`${fromIso}T00:00:00Z`);
  const end = Date.parse(`${toIso}T00:00:00Z`);
  while (start <= end) {
    const chunkEnd = Math.min(start + 290 * DAY_MS, end);
    const url = `https://api.exchange.coinbase.com/products/BTC-USD/candles?granularity=86400`
      + `&start=${new Date(start).toISOString()}&end=${new Date(chunkEnd).toISOString()}`;
    const res = await f(url, { headers: { 'User-Agent': 'opdecoder-price/1.0' } } as RequestInit);
    const arr = JSON.parse((await res.text()).trim()) as number[][];
    for (const c of arr) if (Array.isArray(c) && c.length >= 5) out[dayOf(c[0])] = c[4];
    start = chunkEnd + DAY_MS;
  }
  return out;
}

/** Bitstamp: {data:{ohlc:[{timestamp, close, ...}]}}, até 1000 dias a partir de start.
 *  Devolve date(UTC) -> fechamento USD, cortando o que passar de toIso. */
export async function fetchBitstampDailyClose(fromIso: string, toIso: string, opts: CloseOpts = {}): Promise<Record<string, number>> {
  const f = opts.fetchImpl ?? fetch;
  const start = Math.floor(Date.parse(`${fromIso}T00:00:00Z`) / 1000);
  const url = `https://www.bitstamp.net/api/v2/ohlc/btcusd/?step=86400&limit=1000&start=${start}`;
  const res = await f(url);
  const j = JSON.parse((await res.text()).trim()) as { data?: { ohlc?: { timestamp: string; close: string }[] } };
  const out: Record<string, number> = {};
  for (const o of j.data?.ohlc ?? []) {
    const d = dayOf(Number(o.timestamp));
    if (d <= toIso) out[d] = Number(o.close);
  }
  return out;
}

/** Coinbase primeiro; se falhar/vier vazio, cai pro Bitstamp. */
export async function fetchDailyClose(fromIso: string, toIso: string, opts: CloseOpts = {}): Promise<Record<string, number>> {
  try {
    const cb = await fetchCoinbaseDailyClose(fromIso, toIso, opts);
    if (Object.keys(cb).length > 0) return cb;
  } catch { /* rede/parse falhou → fallback */ }
  return fetchBitstampDailyClose(fromIso, toIso, opts);
}

/** Preenche btcUsd das linhas (in place). Por padrão só toca linhas com btcUsd<=0
 *  (idempotente); all=true sobrescreve todas. Devolve quantas foram preenchidas. */
export function fillPrices(rows: HistoryRow[], closes: Record<string, number>, all = false): number {
  let filled = 0;
  for (const r of rows) {
    if (!all && r.btcUsd > 0) continue;
    const px = closes[r.date];
    if (px && px > 0) { r.btcUsd = px; filled++; }
  }
  return filled;
}
