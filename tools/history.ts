import { readFileSync, writeFileSync, existsSync } from 'node:fs';

// history.csv = uma linha por DATA (UTC), com o agregado dos blocos escaneados
// naquele dia. É o registro durável que o snapshot diário alimenta e o report lê.

export interface HistoryRow {
  date: string; // YYYY-MM-DD (UTC)
  fromHeight: number;
  toHeight: number;
  blocks: number;
  totalTx: number;
  txWithOpReturn: number;
  txAlkanes: number;
  opReturnBytes: number;
  alkanesBytes: number;
}

const COLS: (keyof HistoryRow)[] = [
  'date', 'fromHeight', 'toHeight', 'blocks', 'totalTx', 'txWithOpReturn', 'txAlkanes', 'opReturnBytes', 'alkanesBytes',
];

export function readHistory(path: string): HistoryRow[] {
  if (!existsSync(path)) return [];
  const lines = readFileSync(path, 'utf8').trim().split(/\r?\n/);
  if (lines.length <= 1) return [];
  return lines.slice(1).filter((l) => l.trim()).map((line) => {
    const cells = line.split(',');
    const row = {} as HistoryRow;
    COLS.forEach((c, i) => {
      (row as Record<string, unknown>)[c] = c === 'date' ? cells[i] : Number(cells[i]);
    });
    return row;
  });
}

export function writeHistory(path: string, rows: HistoryRow[]): void {
  const sorted = [...rows].sort((a, b) => a.date.localeCompare(b.date));
  const body = sorted.map((r) => COLS.map((c) => r[c]).join(',')).join('\n');
  writeFileSync(path, `${COLS.join(',')}\n${body}\n`);
}

/** Insere ou substitui a linha da mesma data, mantendo ordenado por data. */
export function upsert(rows: HistoryRow[], row: HistoryRow): HistoryRow[] {
  const out = rows.filter((r) => r.date !== row.date);
  out.push(row);
  return out.sort((a, b) => a.date.localeCompare(b.date));
}

export interface Sums {
  blocks: number; totalTx: number; txWithOpReturn: number; txAlkanes: number; opReturnBytes: number; alkanesBytes: number;
}

/** Soma as linhas com date >= sinceDate (inclusive). */
export function rollup(rows: HistoryRow[], sinceDate: string): Sums {
  const s: Sums = { blocks: 0, totalTx: 0, txWithOpReturn: 0, txAlkanes: 0, opReturnBytes: 0, alkanesBytes: 0 };
  for (const r of rows) {
    if (r.date < sinceDate) continue;
    s.blocks += r.blocks; s.totalTx += r.totalTx; s.txWithOpReturn += r.txWithOpReturn;
    s.txAlkanes += r.txAlkanes; s.opReturnBytes += r.opReturnBytes; s.alkanesBytes += r.alkanesBytes;
  }
  return s;
}

export const alkShareCount = (s: Sums): number => (s.totalTx ? s.txAlkanes / s.totalTx : 0);
export const alkBytesShare = (s: Sums): number => (s.opReturnBytes ? s.alkanesBytes / s.opReturnBytes : 0);
export const opReturnShare = (s: Sums): number => (s.totalTx ? s.txWithOpReturn / s.totalTx : 0);

/** Data UTC (YYYY-MM-DD) deslocada por `days` a partir de hoje. */
export function utcDate(days = 0): string {
  const d = new Date(Date.now() + days * 86_400_000);
  return d.toISOString().slice(0, 10);
}
