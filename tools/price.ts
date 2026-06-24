// Preço diário do BTC em USD via CoinGecko. fetchImpl injetável → testável sem rede.
// Usado no backfill (range, 1 chamada) e no daily (1 dia).

export interface PriceOpts { fetchImpl?: typeof fetch; }

const CG = 'https://api.coingecko.com/api/v3/coins/bitcoin/market_chart/range';

/** date (YYYY-MM-DD UTC) -> preço USD representativo do dia (último ponto do dia). */
export async function fetchRange(fromIso: string, toIso: string, opts: PriceOpts = {}): Promise<Record<string, number>> {
  const f = opts.fetchImpl ?? fetch;
  const from = Math.floor(Date.parse(`${fromIso}T00:00:00Z`) / 1000);
  const to = Math.floor(Date.parse(`${toIso}T23:59:59Z`) / 1000);
  const res = await f(`${CG}?vs_currency=usd&from=${from}&to=${to}`);
  const j = JSON.parse((await res.text()).trim()) as { prices?: [number, number][] };
  const byDate: Record<string, number> = {};
  for (const [ms, usd] of j.prices ?? []) byDate[new Date(ms).toISOString().slice(0, 10)] = usd; // último do dia vence
  return byDate;
}

export async function fetchDay(dateIso: string, opts: PriceOpts = {}): Promise<number> {
  const r = await fetchRange(dateIso, dateIso, opts);
  return r[dateIso] ?? 0;
}
