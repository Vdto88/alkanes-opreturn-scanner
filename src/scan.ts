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
  into.alkanesBytesTotal += from.alkanesBytesTotal;
  into.dieselMints += from.dieselMints;
}

async function scanBlock(height: number, opts: ScanOptions, deps: ScanDeps): Promise<BlockResult> {
  const hash = await deps.blockHash(height, opts);
  const { txs, mediantime } = await deps.fetchBlock(hash, opts);
  const agg = emptyAggregate();
  let decodeFailures = 0;
  for (const tx of txs) {
    const c = classifyTx(tx.vout);
    agg.totalTx += 1;
    if (c.hasOpReturn) agg.txWithOpReturn += 1;
    if (c.isAlkanes) agg.txAlkanes += 1;
    if (c.isDieselMint) agg.dieselMints += 1;
    agg.opReturnBytesTotal += c.opReturnBytes;
    agg.alkanesBytesTotal += c.alkanesBytes;
    if (c.decodeFailed) decodeFailures += 1;
  }
  return { height, hash, time: mediantime, aggregate: agg, decodeFailures };
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
  let decodeFailures = 0;
  let blocksScanned = 0;

  for (let h = fromHeight; h <= toHeight; h += sampleEvery) {
    let block = useCache ? deps.readBlock(cacheDir, h) : null;
    if (!block) {
      block = await scanBlock(h, opts, deps);
      deps.writeBlock(cacheDir, block);
    }
    add(total, block.aggregate);
    decodeFailures += block.decodeFailures;
    blocksScanned += 1;
  }

  return {
    aggregate: total,
    decodeFailures,
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
