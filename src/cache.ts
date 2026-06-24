import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import type { ScanAggregate } from './metrics';

export interface BlockResult {
  height: number;
  hash: string;
  time: number; // mediantime do bloco (unix s) — pra datar com precisão
  aggregate: ScanAggregate;
  decodeFailures: number;
  nonDieselTargets: Record<string, number>; // "block:tx" -> contagem (Alkanes não-DIESEL)
}

const blockPath = (dir: string, height: number): string => join(dir, `${height}.json`);

export function readBlock(dir: string, height: number): BlockResult | null {
  const p = blockPath(dir, height);
  if (!existsSync(p)) return null;
  try {
    return JSON.parse(readFileSync(p, 'utf8')) as BlockResult;
  } catch {
    return null; // cache corrompido -> trata como ausente
  }
}

export function writeBlock(dir: string, result: BlockResult): void {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(blockPath(dir, result.height), JSON.stringify(result));
}
