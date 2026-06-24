import { classifyTx } from './classify';
import { emptyAggregate, type ScanAggregate } from './metrics';
import { readBlock, writeBlock, type BlockResult } from './cache';
import { blockHash, fetchBlock, type EsploraOptions } from './esplora';

export interface Coverage {
  fromHeight: number;
  toHeight: number;
  blocksScanned: number;
  sampled: boolean;
  sampleEvery: number;
  totalTx: number;
  txWithOpReturn: number;
  txAlkanes: number;
}

export interface ScanResult {
  aggregate: ScanAggregate;
  coverage: Coverage;
  decodeFailures: number;
  blocksFailed: number; // blocos pulados por erro de fetch (após retries) — não derrubam o range
  nonDieselTargets: Record<string, number>; // "block:tx" -> contagem (Alkanes não-DIESEL), agregado no range
}

export interface ScanDeps {
  blockHash: typeof blockHash;
  fetchBlock: typeof fetchBlock;
  readBlock: typeof readBlock;
  writeBlock: typeof writeBlock;
}

export interface ScanOptions extends EsploraOptions {
  cacheDir?: string;
  useCache?: boolean;
  sampleEvery?: number;
  deps?: Partial<ScanDeps>;
}

function add(into: ScanAggregate, from: ScanAggregate): void {
  into.totalTx += from.totalTx;
  into.txWithOpReturn += from.txWithOpReturn;
  into.txAlkanes += from.txAlkanes;
  into.opReturnBytesTotal += from.opReturnBytesTotal;
  into.runestoneBytesTotal += from.runestoneBytesTotal;
  into.alkanesBytesTotal += from.alkanesBytesTotal;
  into.dieselMints += from.dieselMints;
  into.feeTotalSats += from.feeTotalSats;
  into.feeAlkanesSats += from.feeAlkanesSats;
  into.feeOpReturnSats += from.feeOpReturnSats;
}

async function scanBlock(height: number, opts: ScanOptions, deps: ScanDeps): Promise<BlockResult> {
  const hash = await deps.blockHash(height, opts);
  const { txs, mediantime } = await deps.fetchBlock(hash, opts);
  const agg = emptyAggregate();
  const nonDieselTargets: Record<string, number> = {};
  let decodeFailures = 0;
  for (const tx of txs) {
    const c = classifyTx(tx.vout);
    agg.totalTx += 1;
    if (c.hasOpReturn) agg.txWithOpReturn += 1;
    if (c.isAlkanes) agg.txAlkanes += 1;
    if (c.isDieselMint) agg.dieselMints += 1;
    agg.opReturnBytesTotal += c.opReturnBytes;
    agg.runestoneBytesTotal += c.runestoneBytes;
    agg.alkanesBytesTotal += c.alkanesBytes;
    if (c.decodeFailed) decodeFailures += 1;
    const fee = tx.is_coinbase ? 0 : (tx.fee ?? 0);
    agg.feeTotalSats += fee;
    if (c.isAlkanes) agg.feeAlkanesSats += fee;
    if (c.hasOpReturn) agg.feeOpReturnSats += fee;
    if (c.nonDieselTarget) nonDieselTargets[c.nonDieselTarget] = (nonDieselTargets[c.nonDieselTarget] ?? 0) + 1;
  }
  return { height, hash, time: mediantime, aggregate: agg, decodeFailures, nonDieselTargets };
}

export async function scanRange(fromHeight: number, toHeight: number, opts: ScanOptions = {}): Promise<ScanResult> {
  const deps: ScanDeps = {
    blockHash: opts.deps?.blockHash ?? blockHash,
    fetchBlock: opts.deps?.fetchBlock ?? fetchBlock,
    readBlock: opts.deps?.readBlock ?? readBlock,
    writeBlock: opts.deps?.writeBlock ?? writeBlock,
  };
  const cacheDir = opts.cacheDir ?? './cache';
  const useCache = opts.useCache ?? true;
  const sampleEvery = Math.max(1, opts.sampleEvery ?? 1);

  const total = emptyAggregate();
  const nonDieselTargets: Record<string, number> = {};
  let decodeFailures = 0;
  let blocksScanned = 0;
  let blocksFailed = 0;

  for (let h = fromHeight; h <= toHeight; h += sampleEvery) {
    try {
      let block = useCache ? deps.readBlock(cacheDir, h) : null;
      if (!block) {
        block = await scanBlock(h, opts, deps);
        deps.writeBlock(cacheDir, block);
      }
      add(total, block.aggregate);
      for (const [k, v] of Object.entries(block.nonDieselTargets ?? {})) nonDieselTargets[k] = (nonDieselTargets[k] ?? 0) + v;
      decodeFailures += block.decodeFailures;
      blocksScanned += 1;
    } catch (e) {
      // 1 bloco falho (após os retries do esplora) não pode descartar horas de scan;
      // como é amostrado, pular um bloco é estatisticamente irrelevante.
      blocksFailed += 1;
      console.error(`bloco ${h} falhou, pulando: ${String(e)}`);
    }
  }

  return {
    aggregate: total,
    decodeFailures,
    blocksFailed,
    nonDieselTargets,
    coverage: {
      fromHeight,
      toHeight,
      blocksScanned,
      sampled: sampleEvery > 1,
      sampleEvery,
      totalTx: total.totalTx,
      txWithOpReturn: total.txWithOpReturn,
      txAlkanes: total.txAlkanes,
    },
  };
}
