import { readFileSync } from 'node:fs';
import { scanRange } from './scan';
import { computeMetrics } from './metrics';
import { formatReport } from './report';
import { tipHeight } from './esplora';
import type { Source } from './esplora';

export interface CliOptions {
  blocks?: number;
  from?: number;
  to?: number;
  source: Source;
  subfrostKey?: string;
  sampleEvery: number;
  useCache: boolean;
}

export function parseArgs(argv: string[]): CliOptions {
  const o: CliOptions = { source: 'subfrost', sampleEvery: 1, useCache: true };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];
    if (a === '--blocks') o.blocks = Number(next());
    else if (a === '--from') o.from = Number(next());
    else if (a === '--to') o.to = Number(next());
    else if (a === '--source') o.source = next() as Source;
    else if (a === '--subfrost-key') o.subfrostKey = next();
    else if (a === '--sample') o.sampleEvery = Number(next());
    else if (a === '--no-cache') o.useCache = false;
  }
  return o;
}

/** key: --subfrost-key > env SUBFROST_KEY > .env.local */
function resolveKey(o: CliOptions): string | undefined {
  if (o.subfrostKey) return o.subfrostKey;
  if (process.env.SUBFROST_KEY) return process.env.SUBFROST_KEY;
  try {
    const m = readFileSync('.env.local', 'utf8').match(/^SUBFROST_KEY=(.+)$/m);
    return m?.[1].trim();
  } catch {
    return undefined;
  }
}

async function main(): Promise<void> {
  const o = parseArgs(process.argv.slice(2));
  const subfrostKey = resolveKey(o);
  const esploraOpts = { source: o.source, subfrostKey };

  let from = o.from;
  let to = o.to;
  if (from === undefined || to === undefined) {
    const tip = await tipHeight(esploraOpts);
    to = tip;
    from = tip - (o.blocks ?? 50) + 1;
  }

  console.error(`Varrendo blocos ${from}..${to} via ${o.source}${o.sampleEvery > 1 ? ` (amostra 1/${o.sampleEvery})` : ''}...`);
  const result = await scanRange(from, to, { ...esploraOpts, sampleEvery: o.sampleEvery, useCache: o.useCache });
  const metrics = computeMetrics(result.aggregate);
  console.log(formatReport(result, metrics));
}

// roda só como entrypoint (não nos testes)
if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('cli.ts')) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
