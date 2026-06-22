import { describe, it, expect } from 'vitest';
import { computeMetrics, emptyAggregate, type ScanAggregate } from './metrics';

describe('computeMetrics', () => {
  it('calcula as 3 métricas por contagem e bytes', () => {
    const a: ScanAggregate = {
      totalTx: 1000,
      txWithOpReturn: 200,
      txAlkanes: 80,
      opReturnBytesTotal: 10000,
      alkanesBytesTotal: 9100,
    };
    const m = computeMetrics(a);
    expect(m.opReturnShareByCount).toBeCloseTo(0.2);       // 200/1000
    expect(m.alkanesOfOpReturnByCount).toBeCloseTo(0.4);   // 80/200
    expect(m.alkanesOfOpReturnByBytes).toBeCloseTo(0.91);  // 9100/10000
    expect(m.alkanesShareByCount).toBeCloseTo(0.08);       // 80/1000
  });

  it('trata divisão por zero (sem tx / sem OP_RETURN)', () => {
    const m = computeMetrics(emptyAggregate());
    expect(m.opReturnShareByCount).toBe(0);
    expect(m.alkanesOfOpReturnByCount).toBe(0);
    expect(m.alkanesOfOpReturnByBytes).toBe(0);
    expect(m.alkanesShareByCount).toBe(0);
  });
});
