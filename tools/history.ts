import { readFileSync, writeFileSync, existsSync } from 'node:fs';

// history.csv = uma linha por DATA (UTC), com o agregado dos blocos escaneados
// naquele dia. É o registro durável que o snapshot diário alimenta e o report lê.

export interface HistoryRow {
  date: string; // YYYY-MM-DD (UTC)
  fromHeight: number;
  toHeight: number;
  blocksScanned: number; // blocos AMOSTRADOS naquele dia (≠ os ~144 que existiram)
  totalTx: number;
  txWithOpReturn: number;
  txAlkanes: number;
  opReturnBytes: number;
  runestoneBytes: number; // bytes de todos os 6a5d (Runes + Alkanes); Runes = runestone − alkanes
  alkanesBytes: number;
  dieselMints: number; // tx que são mint de DIESEL (cellpack 2:0 op77)
  feeTotalSats: number;    // soma das fees de todas as tx do dia (amostra)
  feeAlkanesSats: number;  // fees das tx Alkanes
  feeOpReturnSats: number; // fees das tx com OP_RETURN
  btcUsd: number;          // preço representativo do BTC em USD no dia (0 se indisponível)
  // Colunas do indexer (censo, weight/UG), anexadas no FIM (2026-07-03) pro consumidor externo
  // (subfrost.io) renderizar os 2 gráficos do dashboard que só vinham do arquivo lateral.
  // OPCIONAIS: `undefined` = SEM DADO (célula VAZIA no CSV, NÃO 0 — 0 é valor real, ex.
  // dieselUg=0 no começo de 2025). Vêm do blockspace-daily.json / DayAgg do indexer.
  weightTotal?: number;    // soma do weight (WU) de TODAS as tx dos blocos do dia (censo)
  weightAlkanes?: number;  // soma do weight (WU) das tx Alkanes do dia (censo)
  ugMints?: number;        // mints do rune UNCOMMON•GOODS (1:0) no dia (censo)
  dieselUg?: number;       // mints DIESEL que TAMBÉM carregam UG (numerador do gráfico UG)
}

const COLS: (keyof HistoryRow)[] = [
  'date', 'fromHeight', 'toHeight', 'blocksScanned', 'totalTx', 'txWithOpReturn', 'txAlkanes', 'opReturnBytes', 'runestoneBytes', 'alkanesBytes', 'dieselMints', 'feeTotalSats', 'feeAlkanesSats', 'feeOpReturnSats', 'btcUsd',
  'weightTotal', 'weightAlkanes', 'ugMints', 'dieselUg',
];

export function readHistory(path: string): HistoryRow[] {
  if (!existsSync(path)) return [];
  const lines = readFileSync(path, 'utf8').trim().split(/\r?\n/);
  if (lines.length <= 1) return [];
  const header = lines[0].split(',');
  // Parse por NOME de coluna (não posição): colunas novas ausentes viram 0,
  // então CSVs antigos (sem dieselMints) continuam legíveis.
  return lines.slice(1).filter((l) => l.trim()).map((line) => {
    const cells = line.split(',');
    const at = (col: string): string | undefined => {
      const i = header.indexOf(col);
      return i >= 0 ? cells[i] : undefined;
    };
    const num = (col: string): number => {
      const v = at(col);
      return v !== undefined && v !== '' ? Number(v) : 0;
    };
    // Igual ao num, mas célula VAZIA/ausente vira `undefined` (não 0) — as colunas novas
    // de weight/UG distinguem "sem dado" (vazio) de um zero real (ex. dieselUg=0).
    const numU = (col: string): number | undefined => {
      const v = at(col);
      return v !== undefined && v !== '' ? Number(v) : undefined;
    };
    return {
      date: at('date') ?? '',
      fromHeight: num('fromHeight'),
      toHeight: num('toHeight'),
      blocksScanned: num('blocksScanned'),
      totalTx: num('totalTx'),
      txWithOpReturn: num('txWithOpReturn'),
      txAlkanes: num('txAlkanes'),
      opReturnBytes: num('opReturnBytes'),
      runestoneBytes: num('runestoneBytes'),
      alkanesBytes: num('alkanesBytes'),
      dieselMints: num('dieselMints'),
      feeTotalSats: num('feeTotalSats'),
      feeAlkanesSats: num('feeAlkanesSats'),
      feeOpReturnSats: num('feeOpReturnSats'),
      btcUsd: num('btcUsd'),
      weightTotal: numU('weightTotal'),
      weightAlkanes: numU('weightAlkanes'),
      ugMints: numU('ugMints'),
      dieselUg: numU('dieselUg'),
    };
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
  blocksScanned: number; totalTx: number; txWithOpReturn: number; txAlkanes: number; opReturnBytes: number; runestoneBytes: number; alkanesBytes: number; dieselMints: number;
  feeTotalSats: number; feeAlkanesSats: number; feeOpReturnSats: number;
}

/** Soma as linhas com date >= sinceDate (inclusive). */
export function rollup(rows: HistoryRow[], sinceDate: string): Sums {
  const s: Sums = { blocksScanned: 0, totalTx: 0, txWithOpReturn: 0, txAlkanes: 0, opReturnBytes: 0, runestoneBytes: 0, alkanesBytes: 0, dieselMints: 0, feeTotalSats: 0, feeAlkanesSats: 0, feeOpReturnSats: 0 };
  for (const r of rows) {
    if (r.date < sinceDate) continue;
    s.blocksScanned += r.blocksScanned; s.totalTx += r.totalTx; s.txWithOpReturn += r.txWithOpReturn;
    s.txAlkanes += r.txAlkanes; s.opReturnBytes += r.opReturnBytes; s.runestoneBytes += r.runestoneBytes;
    s.alkanesBytes += r.alkanesBytes; s.dieselMints += r.dieselMints;
    s.feeTotalSats += r.feeTotalSats; s.feeAlkanesSats += r.feeAlkanesSats; s.feeOpReturnSats += r.feeOpReturnSats;
  }
  return s;
}

export const alkShareCount = (s: Sums): number => (s.totalTx ? s.txAlkanes / s.totalTx : 0);
export const alkBytesShare = (s: Sums): number => (s.opReturnBytes ? s.alkanesBytes / s.opReturnBytes : 0);
export const opReturnShare = (s: Sums): number => (s.totalTx ? s.txWithOpReturn / s.totalTx : 0);
export const dieselShareCount = (s: Sums): number => (s.totalTx ? s.dieselMints / s.totalTx : 0);
// Alkanes que NÃO são mint de DIESEL (a diversidade real do protocolo), como % de todas as tx
export const alkExDieselShareCount = (s: Sums): number => (s.totalTx ? Math.max(0, s.txAlkanes - s.dieselMints) / s.totalTx : 0);
// Alkanes DENTRO do universo OP_RETURN: das tx que carregam OP_RETURN, quantas são Alkanes
export const alkOfOpReturnShare = (s: Sums): number => (s.txWithOpReturn ? s.txAlkanes / s.txWithOpReturn : 0);
// Bytes médios de OP_RETURN por tx em cada balde (eficiência): Alkanes vs o resto do OP_RETURN
export const bytesPerAlkanesTx = (s: Sums): number => (s.txAlkanes ? s.alkanesBytes / s.txAlkanes : 0);
export const bytesPerOtherOpReturnTx = (s: Sums): number => {
  const otherTx = s.txWithOpReturn - s.txAlkanes;
  return otherTx > 0 ? Math.max(0, s.opReturnBytes - s.alkanesBytes) / otherTx : 0;
};
// Decomposição dos bytes de OP_RETURN: Alkanes + Runes + Other = 100%
export const runesBytesShare = (s: Sums): number => (s.opReturnBytes ? Math.max(0, s.runestoneBytes - s.alkanesBytes) / s.opReturnBytes : 0);
export const otherBytesShare = (s: Sums): number => (s.opReturnBytes ? Math.max(0, s.opReturnBytes - s.runestoneBytes) / s.opReturnBytes : 0);
// Fees: quanto da receita de fee vem de Alkanes / OP_RETURN
export const feeAlkanesShare = (s: Sums): number => (s.feeTotalSats ? s.feeAlkanesSats / s.feeTotalSats : 0);
export const feeOpReturnShare = (s: Sums): number => (s.feeTotalSats ? s.feeOpReturnSats / s.feeTotalSats : 0);
// Fee MÉDIA por tx (sats): das tx Alkanes vs das não-Alkanes. Mostra se DIESEL é "spam barato"
// (paga pouca fee por tx) vs uma tx normal. 0 (não NaN) quando o balde está vazio.
export const feePerAlkanesTx = (s: Sums): number => (s.txAlkanes ? s.feeAlkanesSats / s.txAlkanes : 0);
export const feePerNonAlkanesTx = (s: Sums): number => {
  const otherTx = s.totalTx - s.txAlkanes;
  return otherTx > 0 ? Math.max(0, s.feeTotalSats - s.feeAlkanesSats) / otherTx : 0;
};
// Receita do minerador no dia (USD): fees extrapoladas da amostra pro dia cheio (×144/blocosAmostrados)
// + subsídio fixo (3,125 BTC/bloco × 144), tudo × preço do BTC. 0 sem preço/amostra.
const SUBSIDY_SATS = 312_500_000; // 3,125 BTC (blocos 930000–955153, entre halvings 840000 e 1050000)
export const minerRevenueUsdDay = (r: HistoryRow): number =>
  (r.blocksScanned ? ((r.feeTotalSats / r.blocksScanned * 144 + 144 * SUBSIDY_SATS) / 1e8) * r.btcUsd : 0);
// Estimativa de mints de DIESEL no dia INTEIRO: extrapola a amostra (mints/blocosAmostrados × 144).
// 0 (não NaN) sem amostra. Base da curva "nascimento" (absoluta) e do acumulado.
export const dieselMintsPerDay = (r: HistoryRow): number =>
  (r.blocksScanned ? (r.dieselMints / r.blocksScanned) * 144 : 0);

/** Data UTC (YYYY-MM-DD) deslocada por `days` a partir de hoje. */
export function utcDate(days = 0): string {
  const d = new Date(Date.now() + days * 86_400_000);
  return d.toISOString().slice(0, 10);
}
