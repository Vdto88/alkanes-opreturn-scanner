import { describe, it, expect } from 'vitest';
import { fetchCoinbaseDailyClose, fetchBitstampDailyClose, fillPrices } from './price-fill';
import type { HistoryRow } from './history';

function mockFetch(body: string) {
  return (async () => ({ ok: true, status: 200, text: async () => body } as Response)) as unknown as typeof fetch;
}

const row = (date: string, btcUsd: number): HistoryRow => ({
  date, fromHeight: 0, toHeight: 0, blocksScanned: 1, totalTx: 0, txWithOpReturn: 0, txAlkanes: 0,
  opReturnBytes: 0, runestoneBytes: 0, alkanesBytes: 0, dieselMints: 0,
  feeTotalSats: 0, feeAlkanesSats: 0, feeOpReturnSats: 0, btcUsd,
});

describe('price-fill', () => {
  it('Coinbase: mapeia candle [time,low,high,open,close,vol] -> date->close (UTC)', async () => {
    // candles descrescentes, time = UTC 00:00; 1737331200 = 2025-01-20
    const body = JSON.stringify([
      [1737417600, 100051, 107291.1, 102145.42, 106159.26, 19411.2],
      [1737331200, 99416.27, 109358.01, 101217.78, 102145.43, 32342.1],
    ]);
    const out = await fetchCoinbaseDailyClose('2025-01-20', '2025-01-21', { fetchImpl: mockFetch(body) });
    expect(out['2025-01-20']).toBe(102145.43); // close (índice 4), não open
    expect(out['2025-01-21']).toBe(106159.26);
  });

  it('Bitstamp: extrai close e corta o que passar de toIso', async () => {
    const body = JSON.stringify({ data: { ohlc: [
      { timestamp: '1737331200', open: '101191', high: '109356', low: '99462', close: '102141', volume: '1' }, // 2025-01-20
      { timestamp: '1737417600', open: '102155', high: '107265', low: '100087', close: '106149', volume: '1' }, // 2025-01-21 (cortado)
    ] } });
    const out = await fetchBitstampDailyClose('2025-01-20', '2025-01-20', { fetchImpl: mockFetch(body) });
    expect(out['2025-01-20']).toBe(102141);
    expect(out['2025-01-21']).toBeUndefined();
  });

  it('fillPrices só toca linhas com btcUsd<=0 (idempotente); --all sobrescreve', () => {
    const closes = { '2025-01-20': 102145, '2025-01-21': 106159 };
    const rows = [row('2025-01-20', 0), row('2025-01-21', 99999)];
    expect(fillPrices(rows, closes)).toBe(1);        // só a de preço 0
    expect(rows[0].btcUsd).toBe(102145);
    expect(rows[1].btcUsd).toBe(99999);              // preservada
    expect(fillPrices(rows, closes, true)).toBe(2);  // --all reescreve as duas
    expect(rows[1].btcUsd).toBe(106159);
  });

  it('fillPrices ignora datas ausentes na fonte (fica 0)', () => {
    const rows = [row('2025-01-20', 0), row('2025-02-30', 0)];
    expect(fillPrices(rows, { '2025-01-20': 102145 })).toBe(1);
    expect(rows[1].btcUsd).toBe(0);
  });
});
