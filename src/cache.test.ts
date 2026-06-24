import { describe, it, expect } from 'vitest';
import { rmSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readBlock, writeBlock, type BlockResult } from './cache';

const dir = mkdtempSync(join(tmpdir(), 'scanner-cache-'));

describe('cache', () => {
  it('round-trip write/read', () => {
    const r: BlockResult = {
      height: 800000,
      hash: 'abcd',
      time: 1782000000,
      aggregate: { totalTx: 3, txWithOpReturn: 2, txAlkanes: 1, opReturnBytesTotal: 50, runestoneBytesTotal: 30, alkanesBytesTotal: 29, dieselMints: 1 },
      decodeFailures: 0,
    };
    writeBlock(dir, r);
    expect(readBlock(dir, 800000)).toEqual(r);
  });

  it('readBlock devolve null quando não há cache', () => {
    expect(readBlock(dir, 999999)).toBeNull();
  });

  it('cleanup', () => { rmSync(dir, { recursive: true, force: true }); });
});
