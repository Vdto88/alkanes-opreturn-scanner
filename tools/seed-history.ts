import { readFileSync, readdirSync } from 'node:fs';
import { writeHistory, type HistoryRow } from './history';

// Semeia o history.csv a partir do cache local (./cache/<h>.json), agrupando
// os blocos por data aproximada (~600s/bloco, ancorado no bloco mais novo).
// Uso: tsx tools/seed-history.ts [cacheDir] [historyPath]

interface Block {
  height: number;
  aggregate: { totalTx: number; txWithOpReturn: number; txAlkanes: number; opReturnBytesTotal: number; alkanesBytesTotal: number };
}

const cacheDir = process.argv[2] ?? 'cache';
const historyPath = process.argv[3] ?? 'history.csv';

const files = readdirSync(cacheDir).filter((f) => f.endsWith('.json'));
if (files.length === 0) {
  console.error(`sem blocos em ${cacheDir}/`);
  process.exit(1);
}
const blocks: Block[] = files.map((f) => JSON.parse(readFileSync(`${cacheDir}/${f}`, 'utf8')));
blocks.sort((a, b) => a.height - b.height);

const maxH = blocks[blocks.length - 1].height;
const now = Date.now();
const dateOf = (h: number) => new Date(now - (maxH - h) * 600_000).toISOString().slice(0, 10);

const byDate = new Map<string, HistoryRow>();
for (const b of blocks) {
  const date = dateOf(b.height);
  const a = b.aggregate;
  const r = byDate.get(date) ?? {
    date, fromHeight: b.height, toHeight: b.height, blocksScanned: 0,
    totalTx: 0, txWithOpReturn: 0, txAlkanes: 0, opReturnBytes: 0, alkanesBytes: 0,
  };
  r.fromHeight = Math.min(r.fromHeight, b.height);
  r.toHeight = Math.max(r.toHeight, b.height);
  r.blocksScanned += 1;
  r.totalTx += a.totalTx;
  r.txWithOpReturn += a.txWithOpReturn;
  r.txAlkanes += a.txAlkanes;
  r.opReturnBytes += a.opReturnBytesTotal;
  r.alkanesBytes += a.alkanesBytesTotal;
  byDate.set(date, r);
}

const rows = [...byDate.values()];
writeHistory(historyPath, rows);
console.log(`${historyPath} semeado: ${rows.length} dias, ${blocks.length} blocos (${rows[0]?.date}..${rows[rows.length - 1]?.date})`);
