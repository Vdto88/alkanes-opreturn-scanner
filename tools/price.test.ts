import { describe, it, expect } from 'vitest';
import { fetchRange, fetchDay } from './price';

// fetch mockado: ignora a url, devolve sempre o mesmo corpo CoinGecko
function mockFetch(body: string) {
  return (async () => ({ ok: true, status: 200, text: async () => body } as Response)) as unknown as typeof fetch;
}

describe('price', () => {
  const body = JSON.stringify({
    prices: [
      [1735430400000, 90000], // 2024-12-29T00:00Z
      [1735470000000, 95000], // 2024-12-29T11:00Z (último do dia 29)
      [1735516800000, 100000], // 2024-12-30T00:00Z
    ],
  });

  it('fetchRange mapeia prices[ms,usd] para date->usd (último do dia)', async () => {
    const out = await fetchRange('2024-12-29', '2024-12-30', { fetchImpl: mockFetch(body) });
    expect(out['2024-12-29']).toBe(95000);
    expect(out['2024-12-30']).toBe(100000);
  });

  it('fetchDay devolve o preço do dia (0 se ausente)', async () => {
    expect(await fetchDay('2024-12-30', { fetchImpl: mockFetch(body) })).toBe(100000);
    expect(await fetchDay('2030-01-01', { fetchImpl: mockFetch(body) })).toBe(0);
  });
});
