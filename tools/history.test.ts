import { describe, it, expect } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readHistory, writeHistory, upsert, rollup, alkShareCount, alkBytesShare, alkExDieselShareCount, alkOfOpReturnShare, bytesPerAlkanesTx, bytesPerOtherOpReturnTx, feeAlkanesShare, feeOpReturnShare, minerRevenueUsdDay, type HistoryRow, type Sums } from './history';

const mk = (date: string, txAlkanes: number, totalTx = 100, alkanesBytes = 90, opReturnBytes = 100): HistoryRow => ({
  date, fromHeight: 1, toHeight: 2, blocksScanned: 1, totalTx, txWithOpReturn: 50, txAlkanes, opReturnBytes, runestoneBytes: alkanesBytes, alkanesBytes, dieselMints: txAlkanes, feeTotalSats: 0, feeAlkanesSats: 0, feeOpReturnSats: 0, btcUsd: 0,
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

  it('alkExDieselShareCount = (txAlkanes − dieselMints) / totalTx', () => {
    const s = {
      blocksScanned: 1, totalTx: 200, txWithOpReturn: 50, txAlkanes: 80,
      opReturnBytes: 100, runestoneBytes: 90, alkanesBytes: 90, dieselMints: 50,
      feeTotalSats: 0, feeAlkanesSats: 0, feeOpReturnSats: 0, btcUsd: 0,
    };
    expect(alkExDieselShareCount(s)).toBeCloseTo(0.15); // (80 − 50) / 200
  });

  it('alkOfOpReturnShare = txAlkanes / txWithOpReturn (Alkanes dentro do OP_RETURN)', () => {
    const s: Sums = {
      blocksScanned: 1, totalTx: 100, txWithOpReturn: 20, txAlkanes: 10,
      opReturnBytes: 500, runestoneBytes: 300, alkanesBytes: 210, dieselMints: 8,
      feeTotalSats: 0, feeAlkanesSats: 0, feeOpReturnSats: 0, btcUsd: 0,
    };
    expect(alkOfOpReturnShare(s)).toBeCloseTo(0.5); // 10 / 20
    // sem nenhum OP_RETURN → 0 (não NaN)
    expect(alkOfOpReturnShare({ ...s, txWithOpReturn: 0 })).toBe(0);
  });

  it('bytesPerAlkanesTx / bytesPerOtherOpReturnTx = bytes médios de OP_RETURN por tx em cada balde', () => {
    const s: Sums = {
      blocksScanned: 1, totalTx: 100, txWithOpReturn: 20, txAlkanes: 10,
      opReturnBytes: 500, runestoneBytes: 300, alkanesBytes: 210, dieselMints: 8,
      feeTotalSats: 0, feeAlkanesSats: 0, feeOpReturnSats: 0, btcUsd: 0,
    };
    expect(bytesPerAlkanesTx(s)).toBeCloseTo(21);          // 210 / 10
    expect(bytesPerOtherOpReturnTx(s)).toBeCloseTo(29);    // (500 − 210) / (20 − 10)
    // sem tx em cada balde → 0 (não NaN/Infinity)
    expect(bytesPerAlkanesTx({ ...s, txAlkanes: 0 })).toBe(0);
    expect(bytesPerOtherOpReturnTx({ ...s, txWithOpReturn: 10, txAlkanes: 10 })).toBe(0);
  });

  it('feeAlkanesShare / feeOpReturnShare = fee do bucket / fee total', () => {
    const s = {
      blocksScanned: 1, totalTx: 10, txWithOpReturn: 5, txAlkanes: 3,
      opReturnBytes: 1, runestoneBytes: 1, alkanesBytes: 1, dieselMints: 1,
      feeTotalSats: 1000, feeAlkanesSats: 800, feeOpReturnSats: 900, btcUsd: 0,
    };
    expect(feeAlkanesShare(s)).toBeCloseTo(0.8);
    expect(feeOpReturnShare(s)).toBeCloseTo(0.9);
  });

  it('minerRevenueUsdDay = (fees extrapoladas + subsídio) * btcUsd', () => {
    const r: HistoryRow = {
      date: '2026-06-20', fromHeight: 1, toHeight: 2, blocksScanned: 1,
      totalTx: 0, txWithOpReturn: 0, txAlkanes: 0, opReturnBytes: 0, runestoneBytes: 0,
      alkanesBytes: 0, dieselMints: 0, feeTotalSats: 1_000_000, feeAlkanesSats: 0, feeOpReturnSats: 0, btcUsd: 100000,
    };
    // feeDayBtc = 1_000_000/1*144/1e8 = 1.44 ; +144*3.125 = 450 ; total 451.44 BTC * 100000 USD
    expect(minerRevenueUsdDay(r)).toBeCloseTo(451.44 * 100000, 0);
  });
});
