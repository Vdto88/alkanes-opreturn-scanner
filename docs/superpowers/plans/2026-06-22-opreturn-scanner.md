# opreturn-scanner Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** CLI TypeScript que varre blocos BTC via esplora e produz as 3 métricas de OP_RETURN/Alkanes (por contagem e por bytes), reusando o `decodeOpReturn` do decoder v1 como classificador.

**Architecture:** Módulos pequenos e puros sempre que possível: `classify` (reusa v1, offline) → `scan` (orquestra fetch+cache+agregação) → `metrics`/`report`. Rede só em `esplora` (endpoint scriptpubkey-only, sem raw hex). Cache em disco por altura, resumível. Injeção de dependências em `scan` para testes determinísticos sem rede.

**Tech Stack:** TypeScript, `tsx`, vitest. Sem deps de runtime — reusa o v1 (`C:\OpDecoder\opreturn-decoder`) por import relativo.

## Global Constraints

- Plataforma: **Windows + Git Bash**; `git -C <path>`; **sem heredoc no PowerShell**; nunca pipar build/test por `| tail`/`| head`.
- **Reuso real do v1:** classificação Alkanes SÓ via `decodeOpReturn` de `../../opreturn-decoder/src/decode` — **não reimplementar** protostone/cellpack.
- **Segredo:** a key subfrost entra por `--subfrost-key`/`SUBFROST_KEY`/`.env.local`; **nunca** commitar (`.env*` já no `.gitignore`).
- devDeps fixos (espelham o v1): `tsx ^4.0.0`, `typescript ^5.4.0`, `vitest ^1.6.0`, `@types/node ^20.0.0`.
- Bytes de OP_RETURN = `len(scriptpubkey hex)/2` (scriptPubKey inteiro). Denominador da métrica 2 = todos os OP_RETURN (`6a`). Coinbase incluída.
- Ratios em `metrics`/`scan` são frações `0..1`; a formatação em `%` é só no `report`.

---

### Task 1: Scaffold do projeto + smoke test do import cross-package

Valida o ponto de integração mais arriscado (importar o decode do v1 de outro pacote) **antes** de construir em cima.

**Files:**
- Create: `package.json`, `tsconfig.json`, `vitest.config.ts`
- Test: `src/smoke.test.ts`

**Interfaces:**
- Consumes: `decodeOpReturn(opReturnHex: string, opReturnVout?: number) => { protostones: { isAlkanes: boolean }[] }` de `../../opreturn-decoder/src/decode`.
- Produces: projeto rodável com `npm test` (vitest) e `npm run scan` (tsx).

- [ ] **Step 1: Criar `package.json`**

```json
{
  "name": "opreturn-scanner",
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "test": "vitest run",
    "scan": "tsx src/cli.ts"
  },
  "devDependencies": {
    "@types/node": "^20.0.0",
    "tsx": "^4.0.0",
    "typescript": "^5.4.0",
    "vitest": "^1.6.0"
  }
}
```

- [ ] **Step 2: Criar `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ES2022",
    "moduleResolution": "bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "types": ["node"]
  },
  "include": ["src"]
}
```

- [ ] **Step 3: Criar `vitest.config.ts`**

`server.fs.allow: ['..']` libera importar `opreturn-decoder` (fora da raiz do projeto). Se o smoke test falhar com erro de "outside allow list", este é o botão.

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  server: { fs: { allow: ['..'] } },
  test: { include: ['src/**/*.test.ts'] },
});
```

- [ ] **Step 4: Instalar deps sem depender da rede (gotcha do changelog)**

Copiar o `node_modules` do v1 (já tem tsx/vitest/typescript/@types/node):

```bash
cp -r "C:/OpDecoder/opreturn-decoder/node_modules" "C:/OpDecoder/opreturn-scanner/node_modules"
```

Fallback se o v1 não tiver: `cd "C:/OpDecoder/opreturn-scanner" && npm install`.

- [ ] **Step 5: Escrever o smoke test**

`src/smoke.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { decodeOpReturn } from '../../opreturn-decoder/src/decode';

// OP_RETURN scriptPubKey real (vout 1 da burned-bond tx do v1) — protostone Alkanes
const ALKANES_OPRETURN = '6a5d1aff7f8196ec8ad08bc0a882edebb78a92908002ff7f9fb5939010';

describe('cross-package reuse do decoder v1', () => {
  it('decodeOpReturn classifica o OP_RETURN Alkanes', () => {
    const r = decodeOpReturn(ALKANES_OPRETURN, 1);
    expect(r.protostones.some((p) => p.isAlkanes)).toBe(true);
  });
});
```

- [ ] **Step 6: Rodar o teste e confirmar que PASSA**

Run: `cd "C:/OpDecoder/opreturn-scanner" && npx vitest run src/smoke.test.ts`
Expected: 1 passed. (Se falhar no resolve do import → ajustar `server.fs.allow`.)

- [ ] **Step 7: Commit**

```bash
git -C "C:/OpDecoder/opreturn-scanner" add package.json tsconfig.json vitest.config.ts src/smoke.test.ts
git -C "C:/OpDecoder/opreturn-scanner" commit -m "chore: scaffold + smoke test do reuso do decoder v1"
```

---

### Task 2: `classify.ts` — classificação por tx

**Files:**
- Create: `src/classify.ts`
- Test: `src/classify.test.ts`

**Interfaces:**
- Consumes: `decodeOpReturn` (Task 1).
- Produces:
  - `interface Vout { scriptpubkey: string }`
  - `interface TxClass { hasOpReturn: boolean; opReturnBytes: number; hasRunestone: boolean; isAlkanes: boolean; alkanesBytes: number; decodeFailed: boolean }`
  - `function classifyTx(vouts: Vout[]): TxClass`

- [ ] **Step 1: Escrever os testes (falhando)**

`src/classify.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { classifyTx } from './classify';

const ALKANES = '6a5d1aff7f8196ec8ad08bc0a882edebb78a92908002ff7f9fb5939010'; // 29 bytes
const WITNESS_COMMIT = '6a24aa21a9ed' + 'ab'.repeat(32); // coinbase, 38 bytes, não-runestone
const MALFORMED_RUNESTONE = '6a5d00'; // 6a5d + opcode inválido -> decode lança
const P2WPKH = '0014' + '11'.repeat(20); // sem OP_RETURN

describe('classifyTx', () => {
  it('OP_RETURN Alkanes: todas as flags + bytes do output', () => {
    const c = classifyTx([{ scriptpubkey: P2WPKH }, { scriptpubkey: ALKANES }]);
    expect(c.hasOpReturn).toBe(true);
    expect(c.hasRunestone).toBe(true);
    expect(c.isAlkanes).toBe(true);
    expect(c.decodeFailed).toBe(false);
    expect(c.opReturnBytes).toBe(29);
    expect(c.alkanesBytes).toBe(29);
  });

  it('witness commitment: OP_RETURN mas não runestone nem Alkanes', () => {
    const c = classifyTx([{ scriptpubkey: WITNESS_COMMIT }]);
    expect(c.hasOpReturn).toBe(true);
    expect(c.hasRunestone).toBe(false);
    expect(c.isAlkanes).toBe(false);
    expect(c.opReturnBytes).toBe(38);
    expect(c.alkanesBytes).toBe(0);
  });

  it('runestone malformado: hasRunestone + decodeFailed, não Alkanes', () => {
    const c = classifyTx([{ scriptpubkey: MALFORMED_RUNESTONE }]);
    expect(c.hasRunestone).toBe(true);
    expect(c.decodeFailed).toBe(true);
    expect(c.isAlkanes).toBe(false);
  });

  it('sem OP_RETURN: tudo falso/zero', () => {
    const c = classifyTx([{ scriptpubkey: P2WPKH }]);
    expect(c.hasOpReturn).toBe(false);
    expect(c.opReturnBytes).toBe(0);
    expect(c.isAlkanes).toBe(false);
  });
});
```

- [ ] **Step 2: Rodar e confirmar FALHA**

Run: `npx vitest run src/classify.test.ts`
Expected: FAIL ("Failed to resolve import './classify'" ou `classifyTx is not a function`).

- [ ] **Step 3: Implementar `src/classify.ts`**

```ts
import { decodeOpReturn } from '../../opreturn-decoder/src/decode';

export interface Vout {
  scriptpubkey: string;
}

export interface TxClass {
  hasOpReturn: boolean;
  opReturnBytes: number;
  hasRunestone: boolean;
  isAlkanes: boolean;
  alkanesBytes: number;
  decodeFailed: boolean;
}

/** Classifica uma tx pelos scriptPubKeys dos vouts. Pura, offline.
 *  OP_RETURN = prefixo 6a; runestone = 6a5d; Alkanes = decodeOpReturn com
 *  algum protostone protocol_tag=1. Bytes = len(scriptpubkey)/2. */
export function classifyTx(vouts: Vout[]): TxClass {
  let hasOpReturn = false;
  let hasRunestone = false;
  let isAlkanes = false;
  let decodeFailed = false;
  let opReturnBytes = 0;
  let alkanesBytes = 0;

  vouts.forEach((v, i) => {
    const spk = v.scriptpubkey.toLowerCase();
    if (!spk.startsWith('6a')) return;
    hasOpReturn = true;
    const bytes = spk.length / 2;
    opReturnBytes += bytes;
    if (!spk.startsWith('6a5d')) return;
    hasRunestone = true;
    try {
      const r = decodeOpReturn(spk, i);
      if (r.protostones.some((p) => p.isAlkanes)) {
        isAlkanes = true;
        alkanesBytes += bytes;
      }
    } catch {
      decodeFailed = true;
    }
  });

  return { hasOpReturn, opReturnBytes, hasRunestone, isAlkanes, alkanesBytes, decodeFailed };
}
```

- [ ] **Step 4: Rodar e confirmar PASSA**

Run: `npx vitest run src/classify.test.ts`
Expected: 4 passed.

- [ ] **Step 5: Commit**

```bash
git -C "C:/OpDecoder/opreturn-scanner" add src/classify.ts src/classify.test.ts
git -C "C:/OpDecoder/opreturn-scanner" commit -m "feat: classifyTx (OP_RETURN/runestone/Alkanes + bytes)"
```

---

### Task 3: `metrics.ts` — as 3 métricas (contagem e bytes)

**Files:**
- Create: `src/metrics.ts`
- Test: `src/metrics.test.ts`

**Interfaces:**
- Produces:
  - `interface ScanAggregate { totalTx: number; txWithOpReturn: number; txAlkanes: number; opReturnBytesTotal: number; alkanesBytesTotal: number }`
  - `interface Metrics { opReturnShareByCount: number; alkanesOfOpReturnByCount: number; alkanesOfOpReturnByBytes: number; alkanesShareByCount: number }`
  - `function emptyAggregate(): ScanAggregate`
  - `function computeMetrics(a: ScanAggregate): Metrics`

- [ ] **Step 1: Escrever os testes (falhando)**

`src/metrics.test.ts`:

```ts
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
```

- [ ] **Step 2: Rodar e confirmar FALHA**

Run: `npx vitest run src/metrics.test.ts`
Expected: FAIL (import não resolve).

- [ ] **Step 3: Implementar `src/metrics.ts`**

```ts
export interface ScanAggregate {
  totalTx: number;
  txWithOpReturn: number;
  txAlkanes: number;
  opReturnBytesTotal: number;
  alkanesBytesTotal: number;
}

export interface Metrics {
  opReturnShareByCount: number;      // métrica 1: tx com OP_RETURN / total
  alkanesOfOpReturnByCount: number;  // métrica 2 (contagem): tx Alkanes / tx com OP_RETURN
  alkanesOfOpReturnByBytes: number;  // métrica 2 (bytes): bytes Alkanes / bytes OP_RETURN
  alkanesShareByCount: number;       // métrica 3: tx Alkanes / total
}

export function emptyAggregate(): ScanAggregate {
  return { totalTx: 0, txWithOpReturn: 0, txAlkanes: 0, opReturnBytesTotal: 0, alkanesBytesTotal: 0 };
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
```

- [ ] **Step 4: Rodar e confirmar PASSA**

Run: `npx vitest run src/metrics.test.ts`
Expected: 2 passed.

- [ ] **Step 5: Commit**

```bash
git -C "C:/OpDecoder/opreturn-scanner" add src/metrics.ts src/metrics.test.ts
git -C "C:/OpDecoder/opreturn-scanner" commit -m "feat: computeMetrics (3 métricas, contagem e bytes)"
```

---

### Task 4: `cache.ts` — persistência por bloco

**Files:**
- Create: `src/cache.ts`
- Test: `src/cache.test.ts`

**Interfaces:**
- Consumes: `ScanAggregate` (Task 3).
- Produces:
  - `interface BlockResult { height: number; hash: string; aggregate: ScanAggregate; decodeFailures: number }`
  - `function readBlock(dir: string, height: number): BlockResult | null`
  - `function writeBlock(dir: string, result: BlockResult): void`

Nota: o cache guarda só o **agregado por bloco** (não a lista por-tx) — é o suficiente para re-agregar as métricas (somas aditivas) e mantém os arquivos pequenos. `--exclude-coinbase` por-tx fica fora do escopo.

- [ ] **Step 1: Escrever os testes (falhando)**

`src/cache.test.ts`:

```ts
import { describe, it, expect, afterEach } from 'vitest';
import { rmSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readBlock, writeBlock, type BlockResult } from './cache';

const dir = mkdtempSync(join(tmpdir(), 'scanner-cache-'));
afterEach(() => { /* mantém o tmp entre testes do arquivo */ });

describe('cache', () => {
  it('round-trip write/read', () => {
    const r: BlockResult = {
      height: 800000,
      hash: 'abcd',
      aggregate: { totalTx: 3, txWithOpReturn: 2, txAlkanes: 1, opReturnBytesTotal: 50, alkanesBytesTotal: 29 },
      decodeFailures: 0,
    };
    writeBlock(dir, r);
    expect(readBlock(dir, 800000)).toEqual(r);
  });

  it('readBlock devolve null quando não há cache', () => {
    expect(readBlock(dir, 999999)).toBeNull();
  });

  it('cleanup', () => { rmSync(dir, { recursive: true, force: true }); });
});
```

- [ ] **Step 2: Rodar e confirmar FALHA**

Run: `npx vitest run src/cache.test.ts`
Expected: FAIL (import não resolve).

- [ ] **Step 3: Implementar `src/cache.ts`**

```ts
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import type { ScanAggregate } from './metrics';

export interface BlockResult {
  height: number;
  hash: string;
  aggregate: ScanAggregate;
  decodeFailures: number;
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
```

- [ ] **Step 4: Rodar e confirmar PASSA**

Run: `npx vitest run src/cache.test.ts`
Expected: 3 passed.

- [ ] **Step 5: Commit**

```bash
git -C "C:/OpDecoder/opreturn-scanner" add src/cache.ts src/cache.test.ts
git -C "C:/OpDecoder/opreturn-scanner" commit -m "feat: cache por bloco (read/write resumível)"
```

---

### Task 5: `esplora.ts` — fetch (scriptpubkey-only, com retry)

**Files:**
- Create: `src/esplora.ts`
- Test: `src/esplora.test.ts`

**Interfaces:**
- Produces:
  - `type Source = 'subfrost' | 'mempool' | 'alkanode'`
  - `interface EsploraOptions { source?: Source; subfrostKey?: string; fetchImpl?: typeof fetch }`
  - `interface EsploraTx { txid: string; vout: { scriptpubkey: string }[] }`
  - `function esploraBase(source: Source, subfrostKey?: string): string`
  - `function tipHeight(opts?: EsploraOptions): Promise<number>`
  - `function blockHash(height: number, opts?: EsploraOptions): Promise<string>`
  - `function blockTxs(hash: string, opts?: EsploraOptions): Promise<EsploraTx[]>`

- [ ] **Step 1: Escrever os testes (falhando)**

`src/esplora.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { esploraBase, tipHeight, blockHash, blockTxs } from './esplora';

// fetch mockado: roteia por URL e retorna Response-like
function mockFetch(routes: Record<string, { ok?: boolean; status?: number; body: string }>) {
  const calls: string[] = [];
  const f = (async (url: string) => {
    calls.push(url);
    const r = routes[url];
    if (!r) throw new Error(`rota inesperada: ${url}`);
    return { ok: r.ok ?? true, status: r.status ?? 200, text: async () => r.body } as Response;
  }) as unknown as typeof fetch;
  return { f, calls };
}

describe('esploraBase', () => {
  it('monta as URLs por source', () => {
    expect(esploraBase('subfrost', 'KEY')).toBe('https://mainnet.subfrost.io/v4/KEY/esplora');
    expect(esploraBase('mempool')).toBe('https://mempool.space/api');
  });
  it('exige key no subfrost', () => {
    expect(() => esploraBase('subfrost')).toThrow();
  });
});

describe('tipHeight', () => {
  it('lê a altura do tip', async () => {
    const { f } = mockFetch({ 'https://mempool.space/api/blocks/tip/height': { body: '850000' } });
    expect(await tipHeight({ source: 'mempool', fetchImpl: f })).toBe(850000);
  });
});

describe('blockTxs', () => {
  it('pagina /25 usando tx_count e devolve todas as tx', async () => {
    const base = 'https://mempool.space/api';
    const { f } = mockFetch({
      [`${base}/block/H/txs/0`]: { body: JSON.stringify([{ txid: 'a', vout: [] }, { txid: 'b', vout: [] }]) },
      [`${base}/block/H`]: { body: JSON.stringify({ tx_count: 2 }) },
    });
    const txs = await blockTxs('H', { source: 'mempool', fetchImpl: f });
    expect(txs.map((t) => t.txid)).toEqual(['a', 'b']);
  });

  it('retry no -32603 transiente do subfrost', async () => {
    const url = 'https://mempool.space/api/blocks/tip/height';
    let n = 0;
    const f = (async () => {
      n++;
      const body = n === 1 ? '{"error":{"code":-32603}}' : '850001';
      return { ok: true, status: 200, text: async () => body } as Response;
    }) as unknown as typeof fetch;
    expect(await tipHeight({ source: 'mempool', fetchImpl: f })).toBe(850001);
    expect(n).toBe(2);
  });
});
```

- [ ] **Step 2: Rodar e confirmar FALHA**

Run: `npx vitest run src/esplora.test.ts`
Expected: FAIL (import não resolve).

- [ ] **Step 3: Implementar `src/esplora.ts`**

```ts
export type Source = 'subfrost' | 'mempool' | 'alkanode';

export interface EsploraOptions {
  source?: Source;
  subfrostKey?: string;
  fetchImpl?: typeof fetch;
}

export interface EsploraTx {
  txid: string;
  vout: { scriptpubkey: string }[];
}

export function esploraBase(source: Source, subfrostKey?: string): string {
  switch (source) {
    case 'subfrost':
      if (!subfrostKey) throw new Error('subfrostKey obrigatória para source subfrost');
      return `https://mainnet.subfrost.io/v4/${subfrostKey}/esplora`;
    case 'mempool':
      return 'https://mempool.space/api';
    case 'alkanode':
      return 'https://api.alkanode.com';
  }
}

/** Texto do GET com até 3 tentativas. Retry cobre HTTP transiente e o
 *  -32603 do gateway subfrost (vem no corpo). */
async function fetchTextRetry(url: string, f: typeof fetch, attempts = 3): Promise<string> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await f(url);
      const text = (await res.text()).trim();
      if (!res.ok || text.includes('-32603')) {
        lastErr = new Error(`HTTP ${res.status}: ${text.slice(0, 80)}`);
        continue;
      }
      return text;
    } catch (e) {
      lastErr = e;
    }
  }
  throw new Error(`fetch falhou ${url}: ${String(lastErr)}`);
}

function base(opts: EsploraOptions): string {
  return esploraBase(opts.source ?? 'subfrost', opts.subfrostKey);
}

export async function tipHeight(opts: EsploraOptions = {}): Promise<number> {
  const f = opts.fetchImpl ?? fetch;
  return Number(await fetchTextRetry(`${base(opts)}/blocks/tip/height`, f));
}

export async function blockHash(height: number, opts: EsploraOptions = {}): Promise<string> {
  const f = opts.fetchImpl ?? fetch;
  return fetchTextRetry(`${base(opts)}/block-height/${height}`, f);
}

export async function blockTxs(hash: string, opts: EsploraOptions = {}): Promise<EsploraTx[]> {
  const f = opts.fetchImpl ?? fetch;
  const b = base(opts);
  const info = JSON.parse(await fetchTextRetry(`${b}/block/${hash}`, f)) as { tx_count: number };
  const out: EsploraTx[] = [];
  for (let start = 0; start < info.tx_count; start += 25) {
    const page = JSON.parse(await fetchTextRetry(`${b}/block/${hash}/txs/${start}`, f)) as EsploraTx[];
    if (page.length === 0) break;
    out.push(...page);
  }
  return out;
}
```

- [ ] **Step 4: Rodar e confirmar PASSA**

Run: `npx vitest run src/esplora.test.ts`
Expected: tudo passa (esploraBase, tipHeight, blockTxs paginação + retry).

- [ ] **Step 5: Commit**

```bash
git -C "C:/OpDecoder/opreturn-scanner" add src/esplora.ts src/esplora.test.ts
git -C "C:/OpDecoder/opreturn-scanner" commit -m "feat: esplora fetch (scriptpubkey-only, paginação + retry)"
```

---

### Task 6: `scan.ts` — orquestração (fetch + cache + agregação)

**Files:**
- Create: `src/scan.ts`
- Test: `src/scan.test.ts`

**Interfaces:**
- Consumes: `classifyTx`/`Vout` (Task 2), `ScanAggregate`/`emptyAggregate` (Task 3), `BlockResult`/`readBlock`/`writeBlock` (Task 4), `EsploraTx`/`blockHash`/`blockTxs`/`EsploraOptions` (Task 5).
- Produces:
  - `interface Coverage { fromHeight: number; toHeight: number; blocksScanned: number; sampled: boolean; sampleEvery: number; totalTx: number; txWithOpReturn: number; txAlkanes: number }`
  - `interface ScanResult { aggregate: ScanAggregate; coverage: Coverage; decodeFailures: number }`
  - `interface ScanDeps { blockHash: typeof import('./esplora').blockHash; blockTxs: typeof import('./esplora').blockTxs; readBlock: typeof import('./cache').readBlock; writeBlock: typeof import('./cache').writeBlock }`
  - `interface ScanOptions extends EsploraOptions { cacheDir?: string; useCache?: boolean; sampleEvery?: number; deps?: Partial<ScanDeps> }`
  - `function scanRange(fromHeight: number, toHeight: number, opts?: ScanOptions): Promise<ScanResult>`

- [ ] **Step 1: Escrever os testes (falhando)**

`src/scan.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { scanRange } from './scan';
import type { BlockResult } from './cache';
import type { EsploraTx } from './esplora';

const ALKANES = '6a5d1aff7f8196ec8ad08bc0a882edebb78a92908002ff7f9fb5939010';
const P2WPKH = '0014' + '11'.repeat(20);

// 2 blocos sintéticos via deps stub; sem rede, sem disco
function stubDeps(blocks: Record<number, EsploraTx[]>) {
  const written: BlockResult[] = [];
  return {
    written,
    deps: {
      blockHash: async (h: number) => `hash${h}`,
      blockTxs: async (hash: string) => blocks[Number(hash.replace('hash', ''))],
      readBlock: () => null,           // força fetch
      writeBlock: (_d: string, r: BlockResult) => { written.push(r); },
    },
  };
}

describe('scanRange', () => {
  it('agrega contagem e bytes de 2 blocos', async () => {
    const { deps, written } = stubDeps({
      100: [{ txid: 'cb', vout: [{ scriptpubkey: P2WPKH }] }, { txid: 'a', vout: [{ scriptpubkey: ALKANES }] }],
      101: [{ txid: 'b', vout: [{ scriptpubkey: P2WPKH }] }],
    });
    const r = await scanRange(100, 101, { useCache: false, deps });
    expect(r.aggregate.totalTx).toBe(3);
    expect(r.aggregate.txWithOpReturn).toBe(1);
    expect(r.aggregate.txAlkanes).toBe(1);
    expect(r.aggregate.opReturnBytesTotal).toBe(29);
    expect(r.aggregate.alkanesBytesTotal).toBe(29);
    expect(r.coverage).toMatchObject({ fromHeight: 100, toHeight: 101, blocksScanned: 2, totalTx: 3 });
    expect(written.length).toBe(2); // gravou cada bloco
  });

  it('usa o cache quando presente (não chama blockTxs)', async () => {
    let txsCalls = 0;
    const cached: BlockResult = {
      height: 100, hash: 'hash100',
      aggregate: { totalTx: 5, txWithOpReturn: 2, txAlkanes: 1, opReturnBytesTotal: 60, alkanesBytesTotal: 29 },
      decodeFailures: 0,
    };
    const r = await scanRange(100, 100, {
      useCache: true,
      deps: {
        blockHash: async () => 'hash100',
        blockTxs: async () => { txsCalls++; return []; },
        readBlock: () => cached,
        writeBlock: () => {},
      },
    });
    expect(txsCalls).toBe(0);
    expect(r.aggregate.totalTx).toBe(5);
  });

  it('amostra 1 a cada K e marca sampled', async () => {
    const { deps } = stubDeps({
      100: [{ txid: 'a', vout: [] }],
      102: [{ txid: 'b', vout: [] }],
    });
    const r = await scanRange(100, 103, { useCache: false, sampleEvery: 2, deps });
    expect(r.coverage.sampled).toBe(true);
    expect(r.coverage.blocksScanned).toBe(2); // 100 e 102
  });
});
```

- [ ] **Step 2: Rodar e confirmar FALHA**

Run: `npx vitest run src/scan.test.ts`
Expected: FAIL (import não resolve).

- [ ] **Step 3: Implementar `src/scan.ts`**

```ts
import { classifyTx } from './classify';
import { emptyAggregate, type ScanAggregate } from './metrics';
import { readBlock, writeBlock, type BlockResult } from './cache';
import { blockHash, blockTxs, type EsploraOptions } from './esplora';

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
  blockTxs: typeof blockTxs;
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
}

async function scanBlock(height: number, opts: ScanOptions, deps: ScanDeps): Promise<BlockResult> {
  const hash = await deps.blockHash(height, opts);
  const txs = await deps.blockTxs(hash, opts);
  const agg = emptyAggregate();
  let decodeFailures = 0;
  for (const tx of txs) {
    const c = classifyTx(tx.vout);
    agg.totalTx += 1;
    if (c.hasOpReturn) agg.txWithOpReturn += 1;
    if (c.isAlkanes) agg.txAlkanes += 1;
    agg.opReturnBytesTotal += c.opReturnBytes;
    agg.alkanesBytesTotal += c.alkanesBytes;
    if (c.decodeFailed) decodeFailures += 1;
  }
  return { height, hash, aggregate: agg, decodeFailures };
}

export async function scanRange(fromHeight: number, toHeight: number, opts: ScanOptions = {}): Promise<ScanResult> {
  const deps: ScanDeps = {
    blockHash: opts.deps?.blockHash ?? blockHash,
    blockTxs: opts.deps?.blockTxs ?? blockTxs,
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
```

- [ ] **Step 4: Rodar e confirmar PASSA**

Run: `npx vitest run src/scan.test.ts`
Expected: 3 passed.

- [ ] **Step 5: Commit**

```bash
git -C "C:/OpDecoder/opreturn-scanner" add src/scan.ts src/scan.test.ts
git -C "C:/OpDecoder/opreturn-scanner" commit -m "feat: scanRange (orquestra fetch/cache/agregação, com amostragem)"
```

---

### Task 7: `report.ts` — saída pronta pra colar

**Files:**
- Create: `src/report.ts`
- Test: `src/report.test.ts`

**Interfaces:**
- Consumes: `ScanResult` (Task 6), `Metrics` (Task 3).
- Produces: `function formatReport(result: ScanResult, metrics: Metrics): string`

- [ ] **Step 1: Escrever o teste (falhando)**

`src/report.test.ts`:

```ts
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
```

- [ ] **Step 2: Rodar e confirmar FALHA**

Run: `npx vitest run src/report.test.ts`
Expected: FAIL (import não resolve).

- [ ] **Step 3: Implementar `src/report.ts`**

```ts
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
```

- [ ] **Step 4: Rodar e confirmar PASSA**

Run: `npx vitest run src/report.test.ts`
Expected: 1 passed.

- [ ] **Step 5: Commit**

```bash
git -C "C:/OpDecoder/opreturn-scanner" add src/report.ts src/report.test.ts
git -C "C:/OpDecoder/opreturn-scanner" commit -m "feat: formatReport (tabela + parágrafo pronto pra colar)"
```

---

### Task 8: `cli.ts` — flags, wiring e rodada de aceite

**Files:**
- Create: `src/cli.ts`, `src/cli.test.ts`
- Create (não commitado): `.env.local`

**Interfaces:**
- Consumes: `scanRange` (Task 6), `computeMetrics` (Task 3), `formatReport` (Task 7), `tipHeight` (Task 5).
- Produces:
  - `interface CliOptions { blocks?: number; from?: number; to?: number; source: Source; subfrostKey?: string; sampleEvery: number; useCache: boolean }`
  - `function parseArgs(argv: string[]): CliOptions`

- [ ] **Step 1: Escrever o teste de `parseArgs` (falhando)**

`src/cli.test.ts`:

```ts
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
```

- [ ] **Step 2: Rodar e confirmar FALHA**

Run: `npx vitest run src/cli.test.ts`
Expected: FAIL (import não resolve).

- [ ] **Step 3: Implementar `src/cli.ts`**

```ts
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
```

- [ ] **Step 4: Rodar e confirmar PASSA**

Run: `npx vitest run src/cli.test.ts`
Expected: 2 passed.

- [ ] **Step 5: Rodar a suíte inteira**

Run: `cd "C:/OpDecoder/opreturn-scanner" && npx vitest run`
Expected: todos os arquivos passam (smoke, classify, metrics, cache, esplora, scan, report, cli).

- [ ] **Step 6: Commit**

```bash
git -C "C:/OpDecoder/opreturn-scanner" add src/cli.ts src/cli.test.ts
git -C "C:/OpDecoder/opreturn-scanner" commit -m "feat: cli (flags + wiring scan->metrics->report)"
```

- [ ] **Step 7: Gravar a key local (gitignored) e rodar a demo de ~50 blocos**

```bash
cd "C:/OpDecoder/opreturn-scanner"
printf 'SUBFROST_KEY=<sua-subfrost-key>\n' > .env.local
git status --porcelain  # confirmar que .env.local NÃO aparece (gitignored)
npx tsx src/cli.ts --blocks 50
```

Expected: imprime a tabela das 3 métricas (contagem+bytes) + cobertura (alturas, nº tx, OP_RETURN, Alkanes, decode-fail) + parágrafo pronto. **Aceite #1.**

- [ ] **Step 8: Cross-check contra o espo (aceite #2)**

Pegar 2–3 txids Alkanes que o scanner marcou e conferir manualmente no espo:
`https://espo.sh/tx/<txid>` — confirmar que o veredito "é Alkanes" bate. Registrar o resultado.
(Opcional: rodar a query Dune do misha `dune.com/queries/6531172` como segundo cross-check de ordem de grandeza.)

---

## Self-Review

**1. Spec coverage:**
- 3 métricas contagem+bytes → Task 3 (metrics) + Task 7 (report). ✓
- Reuso real do v1 (`decodeOpReturn`) → Task 1 (smoke) + Task 2 (classify). ✓
- Fetch scriptpubkey-only + subfrost default + retry -32603 → Task 5. ✓
- Cache resumível por bloco → Task 4 + uso em Task 6. ✓
- Amostragem (`--sample`) + cobertura honesta → Task 6. ✓
- Flags `--blocks/--from/--to/--source/--subfrost-key/--no-cache` → Task 8. ✓
- Key fora do git (`.env.local`) → Global Constraints + Task 8 Step 7. ✓
- Decisões de metodologia (bytes=scriptPubKey, denominador=todos OP_RETURN, coinbase incluída) → Global Constraints + report (ressalvas). ✓
- Aceite #1 (demo 50 blocos) e #2 (espo) → Task 8 Steps 7–8. ✓
- Testes determinísticos com mocks/fixtures → cada task. ✓

**2. Placeholder scan:** Sem TBD/TODO; todo step tem código/comando concreto. ✓

**3. Type consistency:** `TxClass`/`Vout` (classify) consumidos por scan; `ScanAggregate`/`emptyAggregate`/`Metrics` (metrics) por cache/scan/report; `BlockResult`/`readBlock`/`writeBlock` (cache) por scan; `EsploraTx`/`blockHash`/`blockTxs`/`EsploraOptions`/`Source` (esplora) por scan/cli; `ScanResult`/`Coverage` (scan) por report; `scanRange`/`computeMetrics`/`formatReport`/`tipHeight` por cli. Nomes batem entre as tasks. ✓
