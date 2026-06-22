import { describe, it, expect } from 'vitest';
import { parseArgs } from './cli';

describe('parseArgs', () => {
  it('defaults: source subfrost, cache on, sample 1', () => {
    const o = parseArgs([]);
    expect(o.source).toBe('subfrost');
    expect(o.useCache).toBe(true);
    expect(o.sampleEvery).toBe(1);
  });

  it('lê --blocks, --from/--to, --source, --sample, --no-cache, --subfrost-key', () => {
    const o = parseArgs(['--blocks', '50', '--source', 'mempool', '--sample', '4', '--no-cache', '--subfrost-key', 'K']);
    expect(o.blocks).toBe(50);
    expect(o.source).toBe('mempool');
    expect(o.sampleEvery).toBe(4);
    expect(o.useCache).toBe(false);
    expect(o.subfrostKey).toBe('K');

    const r = parseArgs(['--from', '100', '--to', '149']);
    expect(r.from).toBe(100);
    expect(r.to).toBe(149);
  });
});
