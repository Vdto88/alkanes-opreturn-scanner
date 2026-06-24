import { describe, it, expect } from 'vitest';
import { pathToSubfrostMethod, tipHeight, blockTxs } from './esplora';

// fetch mockado: handler decide o corpo da resposta a partir da url/init
function mockFetch(handler: (url: string, init?: RequestInit) => { ok?: boolean; status?: number; body: string }) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const f = (async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    const r = handler(url, init);
    return { ok: r.ok ?? true, status: r.status ?? 200, text: async () => r.body } as Response;
  }) as unknown as typeof fetch;
  return { f, calls };
}

describe('pathToSubfrostMethod', () => {
  it('mapeia path esplora -> método JSON-RPC (/ vira :)', () => {
    expect(pathToSubfrostMethod('/blocks/tip/height')).toBe('esplora_blocks:tip:height');
    expect(pathToSubfrostMethod('/block/abc/txs/0')).toBe('esplora_block:abc:txs:0');
  });
});

describe('tipHeight', () => {
  it('mempool (REST GET): lê texto puro', async () => {
    const { f } = mockFetch((url) => {
      expect(url).toBe('https://mempool.space/api/blocks/tip/height');
      return { body: '850000' };
    });
    expect(await tipHeight({ source: 'mempool', fetchImpl: f })).toBe(850000);
  });

  it('subfrost (JSON-RPC POST): lê result e usa o método mapeado', async () => {
    const { f, calls } = mockFetch(() => ({ body: '{"jsonrpc":"2.0","result":850000,"id":0}' }));
    expect(await tipHeight({ source: 'subfrost', subfrostKey: 'K', fetchImpl: f })).toBe(850000);
    const body = JSON.parse((calls[0].init!.body as string) ?? '{}');
    expect(body.method).toBe('esplora_blocks:tip:height');
  });

  it('subfrost: exige key', async () => {
    await expect(tipHeight({ source: 'subfrost' })).rejects.toThrow();
  });

  it('retry no -32603 transiente do subfrost', async () => {
    let n = 0;
    const f = (async () => {
      n++;
      const body = n === 1
        ? '{"jsonrpc":"2.0","error":{"code":-32603},"id":0}'
        : '{"jsonrpc":"2.0","result":850001,"id":0}';
      return { ok: true, status: 200, text: async () => body } as Response;
    }) as unknown as typeof fetch;
    expect(await tipHeight({ source: 'subfrost', subfrostKey: 'K', fetchImpl: f })).toBe(850001);
    expect(n).toBe(2);
  });

  it('sobrevive a 4 falhas transientes seguidas e depois sucesso', async () => {
    let n = 0;
    const f = (async () => {
      n++;
      const body = n <= 4
        ? '{"jsonrpc":"2.0","error":{"code":-32603},"id":0}'
        : '{"jsonrpc":"2.0","result":850002,"id":0}';
      return { ok: true, status: 200, text: async () => body } as Response;
    }) as unknown as typeof fetch;
    expect(await tipHeight({ source: 'subfrost', subfrostKey: 'K', fetchImpl: f, backoffMs: 0 })).toBe(850002);
    expect(n).toBe(5);
  });

  it('erro do subfrost sem code: ainda dá retry e a mensagem é legível (não "undefined")', async () => {
    let n = 0;
    const f = (async () => {
      n++;
      return { ok: true, status: 200, text: async () => '{"jsonrpc":"2.0","error":{"message":"boom"},"id":0}' } as Response;
    }) as unknown as typeof fetch;
    await expect(tipHeight({ source: 'subfrost', subfrostKey: 'K', fetchImpl: f, backoffMs: 0 })).rejects.toThrow(/boom/);
    expect(n).toBeGreaterThan(1); // tentou de novo, não desistiu na primeira
  });
});

describe('blockTxs', () => {
  it('pagina /25 usando tx_count e devolve todas as tx (mempool)', async () => {
    const base = 'https://mempool.space/api';
    const routes: Record<string, string> = {
      [`${base}/block/H`]: JSON.stringify({ tx_count: 2 }),
      [`${base}/block/H/txs/0`]: JSON.stringify([{ txid: 'a', vout: [] }, { txid: 'b', vout: [] }]),
    };
    const { f } = mockFetch((url) => {
      const body = routes[url];
      if (body === undefined) throw new Error(`rota inesperada: ${url}`);
      return { body };
    });
    const txs = await blockTxs('H', { source: 'mempool', fetchImpl: f });
    expect(txs.map((t) => t.txid)).toEqual(['a', 'b']);
  });

  it('mantém fee e is_coinbase de cada tx', async () => {
    const base = 'https://mempool.space/api';
    const routes: Record<string, string> = {
      [`${base}/block/H`]: JSON.stringify({ tx_count: 2 }),
      [`${base}/block/H/txs/0`]: JSON.stringify([
        { txid: 'cb', vout: [], fee: 0, is_coinbase: true },
        { txid: 'a', vout: [{ scriptpubkey: '6a' }], fee: 1234, is_coinbase: false },
      ]),
    };
    const { f } = mockFetch((url) => { const b = routes[url]; if (b === undefined) throw new Error('rota ' + url); return { body: b }; });
    const txs = await blockTxs('H', { source: 'mempool', fetchImpl: f });
    expect(txs[0].is_coinbase).toBe(true);
    expect(txs[1].fee).toBe(1234);
  });
});
