import { describe, it, expect } from 'vitest';
import { formatReport } from './report';
import type { ScanResult } from './scan';
import type { Metrics } from './metrics';

const result: ScanResult = {
  aggregate: { totalTx: 1000, txWithOpReturn: 200, txAlkanes: 80, opReturnBytesTotal: 10000, alkanesBytesTotal: 9100 },
  decodeFailures: 1,
  coverage: { fromHeight: 100, toHeight: 149, blocksScanned: 50, sampled: false, sampleEvery: 1, totalTx: 1000, txWithOpReturn: 200, txAlkanes: 80 },
};
const metrics: Metrics = {
  opReturnShareByCount: 0.2,
  alkanesOfOpReturnByCount: 0.4,
  alkanesOfOpReturnByBytes: 0.91,
  alkanesShareByCount: 0.08,
};

describe('formatReport', () => {
  it('inclui as métricas formatadas e a cobertura', () => {
    const s = formatReport(result, metrics);
    expect(s).toContain('20.00%');  // OP_RETURN share
    expect(s).toContain('91.00%');  // Alkanes do OP_RETURN por bytes
    expect(s).toContain('8.00%');   // tx = Alkanes
    expect(s).toContain('blocos 100–149');
    expect(s).toContain('coinbase'); // ressalva presente
  });
});
