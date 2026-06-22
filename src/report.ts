import type { ScanResult } from './scan';
import type { Metrics } from './metrics';

const pct = (x: number): string => `${(x * 100).toFixed(2)}%`;

export function formatReport(result: ScanResult, metrics: Metrics): string {
  const { aggregate: a, coverage: c, decodeFailures } = result;
  const lines: string[] = [];

  lines.push('=== OP_RETURN / Alkanes scanner ===');
  lines.push('');
  lines.push(`Cobertura: blocos ${c.fromHeight}–${c.toHeight} (${c.blocksScanned} blocos${c.sampled ? `, amostra 1/${c.sampleEvery}` : ''})`);
  lines.push(`  tx=${a.totalTx}  OP_RETURN=${a.txWithOpReturn}  Alkanes=${a.txAlkanes}  decode-fail=${decodeFailures}`);
  lines.push('');
  lines.push('Métrica                              | por contagem | por bytes');
  lines.push('-------------------------------------|--------------|----------');
  lines.push(`1. tx de BTC com OP_RETURN           | ${pct(metrics.opReturnShareByCount).padStart(12)} | —`);
  lines.push(`2. OP_RETURN que são Alkanes         | ${pct(metrics.alkanesOfOpReturnByCount).padStart(12)} | ${pct(metrics.alkanesOfOpReturnByBytes)}`);
  lines.push(`3. tx de BTC que são Alkanes         | ${pct(metrics.alkanesShareByCount).padStart(12)} | —`);
  lines.push('');
  lines.push('--- pronto pra colar ---');
  lines.push(
    `Numa janela de ${c.blocksScanned} blocos (${c.totalTx} tx), ${pct(metrics.opReturnShareByCount)} das transações ` +
    `de BTC carregam um OP_RETURN; dessas, ${pct(metrics.alkanesOfOpReturnByBytes)} dos *bytes* de OP_RETURN ` +
    `(${pct(metrics.alkanesOfOpReturnByCount)} por contagem) são Alkanes — ou seja, ${pct(metrics.alkanesShareByCount)} ` +
    `de todas as transações de BTC são Alkanes.`,
  );
  lines.push('');
  lines.push('Ressalvas: bytes = scriptPubKey inteiro do output; denominador da métrica 2 = todos os OP_RETURN; ' +
    'coinbase incluída (witness-commitment conta como OP_RETURN, nunca Alkanes).');

  return lines.join('\n');
}
