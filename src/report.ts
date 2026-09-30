import type { ScanResult } from './scan';
import type { Metrics } from './metrics';

const pct = (x: number): string => `${(x * 100).toFixed(2)}%`;

export function formatReport(result: ScanResult, metrics: Metrics): string {
  const { aggregate: a, coverage: c, decodeFailures } = result;
  const lines: string[] = [];

  lines.push('=== OP_RETURN / Alkanes scanner ===');
  lines.push('');
  lines.push(`Coverage: blocks ${c.fromHeight}–${c.toHeight} (${c.blocksScanned} blocks${c.sampled ? `, sample 1/${c.sampleEvery}` : ''})`);
  lines.push(`  tx=${a.totalTx}  OP_RETURN=${a.txWithOpReturn}  Alkanes=${a.txAlkanes}  decode-fail=${decodeFailures}`);
  lines.push('');
  lines.push('Metric                               | by count     | by bytes');
  lines.push('-------------------------------------|--------------|----------');
  lines.push(`1. BTC tx with an OP_RETURN          | ${pct(metrics.opReturnShareByCount).padStart(12)} | -`);
  lines.push(`2. OP_RETURNs that are Alkanes       | ${pct(metrics.alkanesOfOpReturnByCount).padStart(12)} | ${pct(metrics.alkanesOfOpReturnByBytes)}`);
  lines.push(`3. BTC tx that are Alkanes           | ${pct(metrics.alkanesShareByCount).padStart(12)} | -`);
  lines.push('');
  lines.push('--- ready to paste ---');
  lines.push(
    `In a window of ${c.blocksScanned} blocks (${c.totalTx} tx), ${pct(metrics.opReturnShareByCount)} of Bitcoin ` +
    `transactions carry an OP_RETURN; of those, ${pct(metrics.alkanesOfOpReturnByBytes)} of OP_RETURN *bytes* ` +
    `(${pct(metrics.alkanesOfOpReturnByCount)} by count) are Alkanes, so ${pct(metrics.alkanesShareByCount)} ` +
    `of all Bitcoin transactions are Alkanes.`,
  );
  lines.push('');
  lines.push('Caveats: bytes = the whole scriptPubKey of the output; the denominator of metric 2 = all OP_RETURNs; ' +
    'coinbase included (its witness commitment counts as an OP_RETURN, never as Alkanes).');

  return lines.join('\n');
}
