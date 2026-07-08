import { readFileSync, readdirSync } from 'node:fs';
import { readHistory, writeHistory, upsert, upsertMerge, type HistoryRow } from './history';
import { readContracts, writeContracts, upsertContracts } from './contracts';
import { fetchRange } from './price';

const contractsPath = 'contracts-daily.json';

// Constrói linhas diárias a partir do cache local (./cache/<h>.json), datando
// cada bloco pelo seu `time` real (mediantime); cai pra aproximação (~600s/bloco)
// só pros blocos antigos sem time. --merge mantém os dias já existentes no
// history.csv (pra acumular chunks de backfill); sem --merge, sobrescreve.
// Uso: tsx tools/seed-history.ts [cacheDir] [historyPath] [--merge]

interface Block {
  height: number;
  time?: number;
  aggregate: { totalTx: number; txWithOpReturn: number; txAlkanes: number; opReturnBytesTotal: number; runestoneBytesTotal?: number; alkanesBytesTotal: number; dieselMints?: number; feeTotalSats?: number; feeAlkanesSats?: number; feeOpReturnSats?: number };
  nonDieselTargets?: Record<string, number>;
}

const args = process.argv.slice(2).filter((a) => a !== '--merge');
const merge = process.argv.includes('--merge');
const cacheDir = args[0] ?? 'cache';
const historyPath = args[1] ?? 'history.csv';

const files = readdirSync(cacheDir).filter((f) => f.endsWith('.json'));
if (files.length === 0) {
  console.error(`sem blocos em ${cacheDir}/`);
  process.exit(1);
}
const blocks: Block[] = files.map((f) => JSON.parse(readFileSync(`${cacheDir}/${f}`, 'utf8')));
blocks.sort((a, b) => a.height - b.height);

// fallback de data: ~600s/bloco ancorado no bloco mais novo (só pra blocos sem time)
const maxH = blocks[blocks.length - 1].height;
const now = Date.now();
const dateOf = (b: Block): string => {
  const ms = b.time && b.time > 0 ? b.time * 1000 : now - (maxH - b.height) * 600_000;
  return new Date(ms).toISOString().slice(0, 10);
};

const byDate = new Map<string, HistoryRow>();
const byDateContracts = new Map<string, Record<string, number>>();
for (const b of blocks) {
  const date = dateOf(b);
  const a = b.aggregate;
  const r = byDate.get(date) ?? {
    date, fromHeight: b.height, toHeight: b.height, blocksScanned: 0,
    totalTx: 0, txWithOpReturn: 0, txAlkanes: 0, opReturnBytes: 0, runestoneBytes: 0, alkanesBytes: 0, dieselMints: 0,
    feeTotalSats: 0, feeAlkanesSats: 0, feeOpReturnSats: 0, btcUsd: 0,
  };
  r.fromHeight = Math.min(r.fromHeight, b.height);
  r.toHeight = Math.max(r.toHeight, b.height);
  r.blocksScanned += 1;
  r.totalTx += a.totalTx;
  r.txWithOpReturn += a.txWithOpReturn;
  r.txAlkanes += a.txAlkanes;
  r.opReturnBytes += a.opReturnBytesTotal;
  r.runestoneBytes += a.runestoneBytesTotal ?? 0;
  r.alkanesBytes += a.alkanesBytesTotal;
  r.dieselMints += a.dieselMints ?? 0;
  r.feeTotalSats += a.feeTotalSats ?? 0;
  r.feeAlkanesSats += a.feeAlkanesSats ?? 0;
  r.feeOpReturnSats += a.feeOpReturnSats ?? 0;
  byDate.set(date, r);
  if (b.nonDieselTargets) {
    const ct = byDateContracts.get(date) ?? {};
    for (const [k, v] of Object.entries(b.nonDieselTargets)) ct[k] = (ct[k] ?? 0) + v;
    byDateContracts.set(date, ct);
  }
}

let rows = merge ? readHistory(historyPath) : [];
// modo --merge: upsertMerge não deixa uma re-varredura PARCIAL (cache efêmero do Actions)
// rebaixar um dia já censado, e preserva o enriquecimento/preço já presentes.
for (const r of byDate.values()) rows = merge ? upsertMerge(rows, r) : upsert(rows, r);

// preço BTC/USD por dia (não derruba o build se a API falhar)
if (rows.length > 0) {
  try {
    const prices = await fetchRange(rows[0].date, rows[rows.length - 1].date);
    for (const r of rows) r.btcUsd = prices[r.date] ?? r.btcUsd ?? 0;
  } catch (e) {
    console.error(`preço BTC/USD indisponível, btcUsd fica 0: ${String(e)}`);
  }
}
writeHistory(historyPath, rows);

// contratos não-DIESEL por dia (registro durável separado)
let contractRows = merge ? readContracts(contractsPath) : [];
for (const [date, targets] of byDateContracts) contractRows = upsertContracts(contractRows, { date, targets });
writeContracts(contractsPath, contractRows);

console.log(`${historyPath} ${merge ? 'merge' : 'seed'}: ${byDate.size} dias deste cache, ${blocks.length} blocos → ${rows.length} dias | ${contractRows.length} dias de contratos`);
