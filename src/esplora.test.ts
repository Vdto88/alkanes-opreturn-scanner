import { describe, it, expect } from 'vitest';
import { esploraBase, tipHeight, blockTxs } from './esplora';

// fetch mockado: roteia por URL e retorna Response-like
function mockFetch(routes: Record<string, { ok?: boolean; status?: number; body: string }>) {
  const calls: string[] = [];
  const f = (async (url: string) => {
    calls.push(url);
    const r = routes[url];
    if (!r) throw new Error(`rota inesperada: ${url}`);
    return { ok: r.ok ?? true, status: r.status ?? 200, text: async () => r.body } as Response;
  }) as unknown as typeof fetch;
  return { f, calls };
}

describe('esploraBase', () => {
  it('monta as URLs por source', () => {
    expect(esploraBase('subfrost', 'KEY')).toBe('https://mainnet.subfrost.io/v4/KEY/esplora');
    expect(esploraBase('mempool')).toBe('https://mempool.space/api');
  });
  it('exige key no subfrost', () => {
    expect(() => esploraBase('subfrost')).toThrow();
  });
});

describe('tipHeight', () => {
  it('lê a altura do tip', async () => {
    const { f } = mockFetch({ 'https://mempool.space/api/blocks/tip/height': { body: '850000' } });
    expect(await tipHeight({ source: 'mempool', fetchImpl: f })).toBe(850000);
  });
});

describe('blockTxs', () => {
  it('pagina /25 usando tx_count e devolve todas as tx', async () => {
    const base = 'https://mempool.space/api';
    const { f } = mockFetch({
      [`${base}/block/H/txs/0`]: { body: JSON.stringify([{ txid: 'a', vout: [] }, { txid: 'b', vout: [] }]) },
      [`${base}/block/H`]: { body: JSON.stringify({ tx_count: 2 }) },
    });
    const txs = await blockTxs('H', { source: 'mempool', fetchImpl: f });
    expect(txs.map((t) => t.txid)).toEqual(['a', 'b']);
  });

  it('retry no -32603 transiente do subfrost', async () => {
    let n = 0;
    const f = (async () => {
      n++;
      const body = n === 1 ? '{"error":{"code":-32603}}' : '850001';
      return { ok: true, status: 200, text: async () => body } as Response;
    }) as unknown as typeof fetch;
    expect(await tipHeight({ source: 'mempool', fetchImpl: f })).toBe(850001);
    expect(n).toBe(2);
  });
});
