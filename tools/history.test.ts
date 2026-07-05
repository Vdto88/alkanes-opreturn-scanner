import { describe, it, expect } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readHistory, writeHistory, upsert, rollup, alkShareCount, alkBytesShare, alkExDieselShareCount, alkOfOpReturnShare, bytesPerAlkanesTx, bytesPerOtherOpReturnTx, feeAlkanesShare, feeOpReturnShare, feePerAlkanesTx, feePerNonAlkanesTx, dieselMintsPerDay, minerRevenueUsdDay, type HistoryRow, type Sums } from './history';

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

  it('weight/UG: round-trip preserva número e 0 REAL; célula vazia vira undefined (≠ 0)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'hist-'));
    const path = join(dir, 'history.csv');
    const withData: HistoryRow = { ...mk('2025-01-20', 18), weightTotal: 327363183, weightAlkanes: 2_000_000, ugMints: 78, dieselUg: 0 };
    const noData = mk('2025-01-21', 20); // sem weight/UG
    writeHistory(path, [withData, noData]);
    const back = readHistory(path);
    expect(back[0].weightTotal).toBe(327363183);
    expect(back[0].dieselUg).toBe(0);            // 0 real preservado como 0
    expect(back[1].weightTotal).toBeUndefined(); // sem dado ≠ 0
    expect(back[1].dieselUg).toBeUndefined();
    rmSync(dir, { recursive: true, force: true });
  });

  it('sem weight/UG → header de 19 colunas e célula VAZIA (não 0) no CSV', () => {
    const dir = mkdtempSync(join(tmpdir(), 'hist-'));
    const path = join(dir, 'history.csv');
    writeHistory(path, [mk('2025-01-21', 20)]);
    const raw = readFileSync(path, 'utf8').trim().split('\n');
    expect(raw[0].split(',').length).toBe(19);   // 15 + 4 novas
    expect(raw[1].endsWith(',,,,')).toBe(true);   // 4 células vazias no fim
    rmSync(dir, { recursive: true, force: true });
  });

  it('lê CSV antigo de 15 colunas (sem weight/UG) → campos novos undefined', () => {
    const dir = mkdtempSync(join(tmpdir(), 'hist-'));
    const path = join(dir, 'history.csv');
    writeFileSync(path, 'date,fromHeight,toHeight,blocksScanned,totalTx,txWithOpReturn,txAlkanes,opReturnBytes,runestoneBytes,alkanesBytes,dieselMints,feeTotalSats,feeAlkanesSats,feeOpReturnSats,btcUsd\n2025-06-01,1,2,1,100,50,40,100,90,90,40,0,0,0,50000\n');
    const back = readHistory(path);
    expect(back[0].txAlkanes).toBe(40);
    expect(back[0].weightTotal).toBeUndefined();
    expect(back[0].ugMints).toBeUndefined();
    rmSync(dir, { recursive: true, force: true });
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

  it('feePerAlkanesTx / feePerNonAlkanesTx = fee média por tx em cada balde (sats)', () => {
    const s: Sums = {
      blocksScanned: 1, totalTx: 100, txWithOpReturn: 50, txAlkanes: 40,
      opReturnBytes: 1, runestoneBytes: 1, alkanesBytes: 1, dieselMints: 38,
      feeTotalSats: 1_000_000, feeAlkanesSats: 200_000, feeOpReturnSats: 0,
    };
    expect(feePerAlkanesTx(s)).toBeCloseTo(5000);       // 200_000 / 40
    expect(feePerNonAlkanesTx(s)).toBeCloseTo(13333.33, 1); // (1_000_000 − 200_000) / (100 − 40)
    // baldes vazios → 0 (não NaN/Infinity)
    expect(feePerAlkanesTx({ ...s, txAlkanes: 0 })).toBe(0);
    expect(feePerNonAlkanesTx({ ...s, totalTx: 40 })).toBe(0);
  });

  it('dieselMintsPerDay = mints extrapolados pro dia (×144 ÷ blocosAmostrados)', () => {
    expect(dieselMintsPerDay(mk('2025-09-01', 100))).toBeCloseTo(144 * 100); // mk: blocksScanned=1, dieselMints=txAlkanes=100
    expect(dieselMintsPerDay({ ...mk('2025-09-01', 100), blocksScanned: 24, dieselMints: 480 })).toBeCloseTo(480 / 24 * 144);
    expect(dieselMintsPerDay({ ...mk('2025-09-01', 0), blocksScanned: 0 })).toBe(0); // sem amostra → 0
  });
});
