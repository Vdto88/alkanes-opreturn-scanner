import { readHistory, writeHistory } from './history';
import { fetchDailyClose, fetchCoinbaseDailyClose, fetchBitstampDailyClose, fillPrices } from './price-fill';

// Preenche o btcUsd das linhas do history.csv que ficaram em 0 — as datas do
// backfill do genesis do DIESEL (jan–jul/2025) que caem FORA da janela de 365d da
// CoinGecko free (o seed-history deixa 0). Fonte: fechamento diário BTC-USD real
// (Coinbase, fallback Bitstamp). Idempotente: só toca linhas com btcUsd<=0.
// Uso: tsx tools/patch-prices.ts [historyPath] [--all] [--dry] [--source coinbase|bitstamp]

const argv = process.argv.slice(2);
const historyPath = argv.find((a) => !a.startsWith('--')) ?? 'history.csv';
const all = argv.includes('--all');
const dry = argv.includes('--dry');
const si = argv.indexOf('--source');
const source = si >= 0 ? argv[si + 1] : undefined;

const rows = readHistory(historyPath);
const needs = (r: { btcUsd: number }): boolean => all || !(r.btcUsd > 0);
const targets = rows.filter(needs);
if (targets.length === 0) {
  console.log(`patch-prices: nada pra preencher em ${historyPath} (todas as linhas já têm btcUsd)`);
  process.exit(0);
}
const dates = targets.map((r) => r.date).sort();
const from = dates[0];
const to = dates[dates.length - 1];
console.error(`patch-prices: ${targets.length} linha(s) sem preço, faixa ${from}..${to} (source=${source ?? 'coinbase→bitstamp'})`);

const closes = source === 'bitstamp'
  ? await fetchBitstampDailyClose(from, to)
  : source === 'coinbase'
    ? await fetchCoinbaseDailyClose(from, to)
    : await fetchDailyClose(from, to);
console.error(`patch-prices: ${Object.keys(closes).length} fechamentos diários obtidos`);

const filled = fillPrices(rows, closes, all);
const stillZero = rows.filter((r) => !(r.btcUsd > 0)).length;
console.log(`patch-prices: preenchidas ${filled} linha(s); ainda sem preço: ${stillZero}${dry ? ' (dry-run, nada gravado)' : ''}`);
if (!dry) writeHistory(historyPath, rows);
