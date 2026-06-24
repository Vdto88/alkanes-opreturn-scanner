import { describe, it, expect } from 'vitest';
import { scanRange } from './scan';
import type { BlockResult } from './cache';
import type { EsploraTx } from './esplora';

const ALKANES = '6a5d1aff7f8196ec8ad08bc0a882edebb78a92908002ff7f9fb5939010';
const P2WPKH = '0014' + '11'.repeat(20);

// 2 blocos sintéticos via deps stub; sem rede, sem disco
function stubDeps(blocks: Record<number, EsploraTx[]>) {
  const written: BlockResult[] = [];
  return {
    written,
    deps: {
      blockHash: async (h: number) => `hash${h}`,
      fetchBlock: async (hash: string) => ({ txs: blocks[Number(hash.replace('hash', ''))], mediantime: 1782000000 }),
      readBlock: () => null,           // força fetch
      writeBlock: (_d: string, r: BlockResult) => { written.push(r); },
    },
  };
}

describe('scanRange', () => {
  it('agrega contagem e bytes de 2 blocos', async () => {
    const { deps, written } = stubDeps({
      100: [{ txid: 'cb', vout: [{ scriptpubkey: P2WPKH }] }, { txid: 'a', vout: [{ scriptpubkey: ALKANES }] }],
      101: [{ txid: 'b', vout: [{ scriptpubkey: P2WPKH }] }],
    });
    const r = await scanRange(100, 101, { useCache: false, deps });
    expect(r.aggregate.totalTx).toBe(3);
    expect(r.aggregate.txWithOpReturn).toBe(1);
    expect(r.aggregate.txAlkanes).toBe(1);
    expect(r.aggregate.opReturnBytesTotal).toBe(29);
    expect(r.aggregate.alkanesBytesTotal).toBe(29);
    expect(r.coverage).toMatchObject({ fromHeight: 100, toHeight: 101, blocksScanned: 2, totalTx: 3 });
    expect(written.length).toBe(2); // gravou cada bloco
  });

  it('usa o cache quando presente (não chama blockTxs)', async () => {
    let txsCalls = 0;
    const cached: BlockResult = {
      height: 100, hash: 'hash100', time: 1782000000,
      aggregate: { totalTx: 5, txWithOpReturn: 2, txAlkanes: 1, opReturnBytesTotal: 60, alkanesBytesTotal: 29, dieselMints: 1 },
      decodeFailures: 0,
    };
    const r = await scanRange(100, 100, {
      useCache: true,
      deps: {
        blockHash: async () => 'hash100',
        fetchBlock: async () => { txsCalls++; return { txs: [], mediantime: 0 }; },
        readBlock: () => cached,
        writeBlock: () => {},
      },
    });
    expect(txsCalls).toBe(0);
    expect(r.aggregate.totalTx).toBe(5);
  });

  it('amostra 1 a cada K e marca sampled', async () => {
    const { deps } = stubDeps({
      100: [{ txid: 'a', vout: [] }],
      102: [{ txid: 'b', vout: [] }],
    });
    const r = await scanRange(100, 103, { useCache: false, sampleEvery: 2, deps });
    expect(r.coverage.sampled).toBe(true);
    expect(r.coverage.blocksScanned).toBe(2); // 100 e 102
  });
});
