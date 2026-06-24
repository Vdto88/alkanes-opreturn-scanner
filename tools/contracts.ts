import { readFileSync, writeFileSync, existsSync } from 'node:fs';

// Registro durável dos alvos de cellpack das tx Alkanes NÃO-DIESEL, por dia.
// Cardinalidade variável (não cabe em coluna do history.csv) → arquivo próprio.
// Mesmo padrão do history: upsert por data; backfill reconstrói, daily faz upsert do dia.

export interface ContractsRow {
  date: string; // YYYY-MM-DD (UTC)
  targets: Record<string, number>; // "block:tx" -> contagem de interações naquele dia
}

export function readContracts(path: string): ContractsRow[] {
  if (!existsSync(path)) return [];
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as ContractsRow[];
  } catch {
    return [];
  }
}

export function writeContracts(path: string, rows: ContractsRow[]): void {
  const sorted = [...rows].sort((a, b) => a.date.localeCompare(b.date));
  writeFileSync(path, `${JSON.stringify(sorted)}\n`);
}

/** Insere ou substitui a linha da mesma data, mantendo ordenado por data. */
export function upsertContracts(rows: ContractsRow[], row: ContractsRow): ContractsRow[] {
  const out = rows.filter((r) => r.date !== row.date);
  out.push(row);
  return out.sort((a, b) => a.date.localeCompare(b.date));
}

/** Soma all-time por alvo e devolve os top N (desc por contagem). */
export function topTargets(rows: ContractsRow[], n: number): { id: string; count: number }[] {
  const tot: Record<string, number> = {};
  for (const r of rows) for (const [k, v] of Object.entries(r.targets)) tot[k] = (tot[k] ?? 0) + v;
  return Object.entries(tot)
    .map(([id, count]) => ({ id, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, n);
}
