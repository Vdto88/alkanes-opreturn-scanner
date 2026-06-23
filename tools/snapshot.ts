import { readFileSync } from 'node:fs';
import { scanRange } from '../src/scan';
import { tipHeight, type Source } from '../src/esplora';
import { readHistory, writeHistory, upsert, utcDate, type HistoryRow } from './history';

// Escaneia uma janela recente e grava/atualiza a linha de HOJE no history.csv.
// Pensado pra rodar 1x/dia (GitHub Actions). Uso:
//   tsx tools/snapshot.ts [--blocks 144] [--sample 6] [--source subfrost]
//                         [--subfrost-key K] [--concurrency 16] [--history history.csv]

function arg(name: string, def?: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : def;
}

function resolveKey(flag?: string): string | undefined {
  if (flag) return flag;
  if (process.env.SUBFROST_KEY) return process.env.SUBFROST_KEY;
  try {
    return readFileSync('.env.local', 'utf8').match(/^SUBFROST_KEY=(.+)$/m)?.[1].trim();
  } catch {
    return undefined;
  }
}

const blocks = Number(arg('--blocks', '144'));
const sampleEvery = Number(arg('--sample', '6'));
const source = (arg('--source', 'subfrost') as Source);
const concurrency = Number(arg('--concurrency', '16'));
const historyPath = arg('--history', 'history.csv')!;
const subfrostKey = resolveKey(arg('--subfrost-key'));

const opts = { source, subfrostKey, concurrency };
const tip = await tipHeight(opts);
const from = tip - blocks + 1;
console.error(`snapshot: blocos ${from}..${tip} via ${source} (amostra 1/${sampleEvery})...`);

const result = await scanRange(from, tip, { ...opts, sampleEvery });
const a = result.aggregate;
const row: HistoryRow = {
  date: utcDate(0),
  fromHeight: from,
  toHeight: tip,
  blocks: result.coverage.blocksScanned,
  totalTx: a.totalTx,
  txWithOpReturn: a.txWithOpReturn,
  txAlkanes: a.txAlkanes,
  opReturnBytes: a.opReturnBytesTotal,
  alkanesBytes: a.alkanesBytesTotal,
};

const rows = upsert(readHistory(historyPath), row);
writeHistory(historyPath, rows);

const pc = (n: number, d: number) => (d ? (n / d * 100).toFixed(2) : '0') + '%';
console.log(`${row.date}: ${row.totalTx} tx | tx=Alkanes ${pc(row.txAlkanes, row.totalTx)} | bytes=Alkanes ${pc(row.alkanesBytes, row.opReturnBytes)} (${rows.length} dias no histórico)`);
