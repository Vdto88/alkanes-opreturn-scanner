import { describe, it, expect } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readHistory, writeHistory, upsert, rollup, alkShareCount, alkBytesShare, type HistoryRow } from './history';

const mk = (date: string, txAlkanes: number, totalTx = 100, alkanesBytes = 90, opReturnBytes = 100): HistoryRow => ({
  date, fromHeight: 1, toHeight: 2, blocks: 1, totalTx, txWithOpReturn: 50, txAlkanes, opReturnBytes, alkanesBytes,
});

describe('history csv', () => {
  it('round-trip write/read', () => {
    const dir = mkdtempSync(join(tmpdir(), 'hist-'));
    const path = join(dir, 'history.csv');
    const rows = [mk('2026-06-20', 40), mk('2026-06-21', 60)];
    writeHistory(path, rows);
    expect(readHistory(path)).toEqual(rows);
    rmSync(dir, { recursive: true, force: true });
  });

  it('readHistory devolve [] quando não existe', () => {
    expect(readHistory(join(tmpdir(), 'nao-existe-xyz.csv'))).toEqual([]);
  });

  it('upsert substitui a linha da mesma data e mantém ordenado', () => {
    let rows = [mk('2026-06-20', 40)];
    rows = upsert(rows, mk('2026-06-19', 10));
    rows = upsert(rows, mk('2026-06-20', 55)); // substitui
    expect(rows.map((r) => r.date)).toEqual(['2026-06-19', '2026-06-20']);
    expect(rows[1].txAlkanes).toBe(55);
  });

  it('rollup soma date >= sinceDate e os shares batem', () => {
    const rows = [mk('2026-06-18', 30), mk('2026-06-20', 50), mk('2026-06-21', 70)];
    const s = rollup(rows, '2026-06-20');
    expect(s.totalTx).toBe(200);       // só 06-20 e 06-21
    expect(s.txAlkanes).toBe(120);
    expect(alkShareCount(s)).toBeCloseTo(0.6);
    expect(alkBytesShare(s)).toBeCloseTo(0.9);
  });
});
