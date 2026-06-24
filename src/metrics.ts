export interface ScanAggregate {
  totalTx: number;
  txWithOpReturn: number;
  txAlkanes: number;
  opReturnBytesTotal: number;
  alkanesBytesTotal: number;
  dieselMints: number;
}

export interface Metrics {
  opReturnShareByCount: number;      // métrica 1: tx com OP_RETURN / total
  alkanesOfOpReturnByCount: number;  // métrica 2 (contagem): tx Alkanes / tx com OP_RETURN
  alkanesOfOpReturnByBytes: number;  // métrica 2 (bytes): bytes Alkanes / bytes OP_RETURN
  alkanesShareByCount: number;       // métrica 3: tx Alkanes / total
}

export function emptyAggregate(): ScanAggregate {
  return { totalTx: 0, txWithOpReturn: 0, txAlkanes: 0, opReturnBytesTotal: 0, alkanesBytesTotal: 0, dieselMints: 0 };
}

const ratio = (num: number, den: number): number => (den === 0 ? 0 : num / den);

export function computeMetrics(a: ScanAggregate): Metrics {
  return {
    opReturnShareByCount: ratio(a.txWithOpReturn, a.totalTx),
    alkanesOfOpReturnByCount: ratio(a.txAlkanes, a.txWithOpReturn),
    alkanesOfOpReturnByBytes: ratio(a.alkanesBytesTotal, a.opReturnBytesTotal),
    alkanesShareByCount: ratio(a.txAlkanes, a.totalTx),
  };
}
