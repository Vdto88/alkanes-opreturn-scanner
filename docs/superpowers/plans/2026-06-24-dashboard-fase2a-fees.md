# Fase 2a — Fees / miner revenue Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Capture per-tx fees + non-DIESEL target contracts in one scan pass, add a daily BTC/USD price, store it all durably, re-scan the period once, and ship the miner-fee-revenue (USD+BTC) report.

**Architecture:** Fees flow as numbers through `ScanAggregate` (summed by the existing `add()`); non-DIESEL targets ride on `BlockResult`/`ScanResult` as a `{ "block:tx": count }` map and persist to a new durable `contracts-daily.json` (consumed in Fase 2b). A new `tools/price.ts` fetches BTC/USD. After the scanner changes land, one `backfill.yml` re-scan repopulates everything.

**Tech Stack:** TypeScript (ESM), `tsx`, `vitest`, Chart.js (CDN), CoinGecko REST. Windows + Git Bash.

## Global Constraints

- Capturing BOTH fees and non-DIESEL targets lands in 2a so the re-scan is single (the target *ranking* renders in 2b).
- NEVER commit the subfrost key — `git diff | grep 3cdaa58a` before each commit; expect no match.
- All existing tests stay green; this plan adds tests (target ≈ 31 → ~42).
- Block subsidy = **3.125 BTC = 312_500_000 sats** (constant for heights 930000–955153).
- Parser reads CSV columns by name with default 0 → old CSVs stay valid. Keep that property for new columns.
- Commit messages in Portuguese; end each with `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.
- `build-report.ts`/`seed-history.ts`/`snapshot.ts` are generator scripts (no unit suite) → verify by running + grep + `node --check`.

---

## File Structure

- `src/esplora.ts` — `EsploraTx` gains `fee`, `is_coinbase`; `fetchBlock` keeps them.
- `src/classify.ts` — `TxClass.nonDieselTarget?: string`.
- `src/metrics.ts` — `ScanAggregate` fee fields + `emptyAggregate`.
- `src/scan.ts` — `scanBlock` sums fees + builds per-block target map; `add()` sums fees; `BlockResult`/`ScanResult` carry `nonDieselTargets`.
- `src/cache.ts` — `BlockResult.nonDieselTargets`.
- `tools/contracts.ts` (new) — durable `contracts-daily.json` read/write/upsert + `topTargets`.
- `tools/price.ts` (new) — CoinGecko BTC/USD `fetchRange`/`fetchDay`.
- `tools/history.ts` — `HistoryRow`/`COLS`/`Sums` fee+`btcUsd` + fee-metric helpers.
- `tools/seed-history.ts`, `tools/snapshot.ts` — write fees + `btcUsd` + `contracts-daily.json`.
- `tools/build-report.ts` — miner-fee-revenue chart + fee-share (2a report).

---

### Task 1: esplora — carry `fee` and `is_coinbase`

**Files:** Modify `src/esplora.ts` (EsploraTx ~line 11-14; `fetchBlock` pages map ~line 101). Test `src/esplora.test.ts`.

**Interfaces:** Produces `EsploraTx { txid; vout; fee?: number; is_coinbase?: boolean }`.

- [ ] **Step 1: Failing test** — add to `src/esplora.test.ts` inside `describe('blockTxs')`:

```ts
  it('mantém fee e is_coinbase de cada tx (mempool)', async () => {
    const base = 'https://mempool.space/api';
    const routes: Record<string, string> = {
      [`${base}/block/H`]: JSON.stringify({ tx_count: 2 }),
      [`${base}/block/H/txs/0`]: JSON.stringify([
        { txid: 'cb', vout: [], fee: 0, is_coinbase: true },
        { txid: 'a', vout: [{ scriptpubkey: '6a' }], fee: 1234, is_coinbase: false },
      ]),
    };
    const { f } = mockFetch((url) => { const b = routes[url]; if (b === undefined) throw new Error('rota '+url); return { body: b }; });
    const txs = await blockTxs('H', { source: 'mempool', fetchImpl: f });
    expect(txs[0].is_coinbase).toBe(true);
    expect(txs[1].fee).toBe(1234);
  });
```

- [ ] **Step 2: Run, expect FAIL** — `./node_modules/.bin/vitest run src/esplora.test.ts` → fails (`fee`/`is_coinbase` undefined on EsploraTx type / not carried).

- [ ] **Step 3: Implement** — in `src/esplora.ts` extend the interface:

```ts
export interface EsploraTx {
  txid: string;
  vout: { scriptpubkey: string }[];
  fee?: number;
  is_coinbase?: boolean;
}
```
The fetch already `JSON.parse`s the full tx objects into `pages[i]` (line ~101: `pages[i] = (await esploraRequest(...)) as EsploraTx[]`), so `fee`/`is_coinbase` are preserved automatically — no mapping change needed. (The test proves it.)

- [ ] **Step 4: Run, expect PASS** — `./node_modules/.bin/vitest run src/esplora.test.ts`.

- [ ] **Step 5: Commit** — `git add src/esplora.ts src/esplora.test.ts && git commit -m "feat: esplora carrega fee e is_coinbase por tx" -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"`

---

### Task 2: classify — `nonDieselTarget`

**Files:** Modify `src/classify.ts` (TxClass + body). Test `src/classify.test.ts`.

**Interfaces:** Produces `TxClass.nonDieselTarget?: string` — `"block:tx"` of the first Alkanes protostone cellpack when the tx is Alkanes and NOT a DIESEL mint; else `undefined`.

- [ ] **Step 1: Failing test** — add to `src/classify.test.ts` (match its existing style; reuse its ALKANES-style fixtures). Use a known non-DIESEL Alkanes scriptpubkey. If the test file already has an Alkanes example targeting a non-{2,0} contract, assert on it; otherwise add:

```ts
  it('nonDieselTarget = "block:tx" do cellpack quando Alkanes não-DIESEL', () => {
    // protostone Alkanes chamando contrato 2:77087 (não é mint DIESEL 2:0 op77)
    const spk = '6a5d' + 'NN'; // substituir NN pelo corpo real de um cellpack target 2:77087 (ver classify.test fixtures)
    const c = classifyTx([{ scriptpubkey: spk }]);
    expect(c.isAlkanes).toBe(true);
    expect(c.isDieselMint).toBe(false);
    expect(c.nonDieselTarget).toBe('2:77087');
  });
```
NOTE for implementer: build the fixture from a real decoded sample. Cheapest path — pick an existing Alkanes (non-DIESEL) hex already used elsewhere in the repo/tests, decode it once with `tsx` to read `target.block:target.tx`, and assert that value. Keep DIESEL fixture (2:0 op77) asserting `nonDieselTarget` is `undefined`.

- [ ] **Step 2: Run, expect FAIL** — `./node_modules/.bin/vitest run src/classify.test.ts` (property missing).

- [ ] **Step 3: Implement** — in `src/classify.ts`: add `nonDieselTarget` to `TxClass`, a local `let nonDieselTarget: string | undefined;`, and inside the decode try-block, after computing `isAlkanes`/`isDieselMint`, capture the first Alkanes cellpack target when not DIESEL:

```ts
      const ap = r.protostones.find((p) => p.isAlkanes && p.cellpack);
      if (ap?.cellpack && nonDieselTarget === undefined) {
        const t = `${ap.cellpack.target.block}:${ap.cellpack.target.tx}`;
        // só conta como "não-DIESEL" se a tx não for mint de DIESEL
        nonDieselTarget = t; // será descartado abaixo se isDieselMint
      }
```
Then return it as `nonDieselTarget: isDieselMint ? undefined : nonDieselTarget`. Add `nonDieselTarget` to the returned object.

- [ ] **Step 4: Run, expect PASS** — `./node_modules/.bin/vitest run src/classify.test.ts`.

- [ ] **Step 5: Commit** — `git add src/classify.ts src/classify.test.ts && git commit -m "feat: classify expõe nonDieselTarget (alvo do cellpack p/ ranking)" -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"`

---

### Task 3: metrics — fee fields in `ScanAggregate`

**Files:** Modify `src/metrics.ts`. Test `src/metrics.test.ts`.

**Interfaces:** Produces `ScanAggregate` with `feeTotalSats`, `feeAlkanesSats`, `feeOpReturnSats`; `emptyAggregate()` zeroes them.

- [ ] **Step 1: Failing test** — add to `src/metrics.test.ts`:

```ts
  it('emptyAggregate zera os campos de fee', () => {
    const a = emptyAggregate();
    expect(a.feeTotalSats).toBe(0);
    expect(a.feeAlkanesSats).toBe(0);
    expect(a.feeOpReturnSats).toBe(0);
  });
```

- [ ] **Step 2: Run, expect FAIL** — `./node_modules/.bin/vitest run src/metrics.test.ts`.

- [ ] **Step 3: Implement** — add the three fields to `ScanAggregate` and to the object in `emptyAggregate()` (all `0`).

- [ ] **Step 4: Run, expect PASS.**

- [ ] **Step 5: Commit** — `git add src/metrics.ts src/metrics.test.ts && git commit -m "feat: campos de fee em ScanAggregate" -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"`

---

### Task 4: scan — sum fees + build per-block target map

**Files:** Modify `src/cache.ts` (`BlockResult`), `src/scan.ts` (`add`, `scanBlock`, `scanRange`, `ScanResult`). Test `src/scan.test.ts`.

**Interfaces:** `BlockResult.nonDieselTargets: Record<string,number>`; `ScanResult.nonDieselTargets: Record<string,number>` (merged over range); aggregate carries fee sums.

- [ ] **Step 1: Failing test** — add to `src/scan.test.ts`. Extend `stubDeps` blocks to carry `fee`/`is_coinbase` and use a non-DIESEL Alkanes tx; assert sums:

```ts
  it('soma fees por bucket e agrega nonDieselTargets', async () => {
    const { deps } = stubDeps({
      100: [
        { txid: 'cb', vout: [{ scriptpubkey: P2WPKH }], fee: 0, is_coinbase: true },
        { txid: 'a', vout: [{ scriptpubkey: ALKANES }], fee: 500 },
      ],
    });
    const r = await scanRange(100, 100, { useCache: false, deps });
    expect(r.aggregate.feeTotalSats).toBe(500);
    expect(r.aggregate.feeOpReturnSats).toBe(500); // ALKANES é OP_RETURN
    expect(typeof r.nonDieselTargets).toBe('object');
  });
```
(`ALKANES` const already in scan.test.ts is a DIESEL-ish sample; if it classifies as DIESEL, `feeAlkanesSats` should still be 500. Assert `feeAlkanesSats` ≥ 0 and total/opreturn as above. Adjust the non-DIESEL-target assertion to the real classification of the fixture.)

- [ ] **Step 2: Run, expect FAIL.**

- [ ] **Step 3: Implement:**
  - `src/cache.ts`: add `nonDieselTargets: Record<string, number>;` to `BlockResult`.
  - `src/scan.ts` `add()`: add `into.feeTotalSats += from.feeTotalSats; into.feeAlkanesSats += from.feeAlkanesSats; into.feeOpReturnSats += from.feeOpReturnSats;`
  - `scanBlock`: in the tx loop, after `classifyTx`, do:
    ```ts
    const fee = tx.is_coinbase ? 0 : (tx.fee ?? 0);
    agg.feeTotalSats += fee;
    if (c.isAlkanes) agg.feeAlkanesSats += fee;
    if (c.hasOpReturn) agg.feeOpReturnSats += fee;
    if (c.nonDieselTarget) targets[c.nonDieselTarget] = (targets[c.nonDieselTarget] ?? 0) + 1;
    ```
    where `const targets: Record<string,number> = {};` is declared before the loop; return `{ ...everything, nonDieselTargets: targets }` in `BlockResult`.
  - `scanRange`: add `ScanResult.nonDieselTargets`; declare `const nonDieselTargets: Record<string,number> = {};` and after `add(total, block.aggregate)` merge: `for (const [k,v] of Object.entries(block.nonDieselTargets ?? {})) nonDieselTargets[k]=(nonDieselTargets[k]??0)+v;` Return it.
  - The `tx` type in `scanBlock` loop is `EsploraTx` (has `fee`/`is_coinbase` from Task 1).

- [ ] **Step 4: Run, expect PASS** — `./node_modules/.bin/vitest run src/scan.test.ts`.

- [ ] **Step 5: Commit** — `git add src/scan.ts src/cache.ts src/scan.test.ts && git commit -m "feat: scan soma fees por bucket + mapa de alvos não-DIESEL por bloco" -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"`

---

### Task 5: `tools/contracts.ts` — durable contracts-daily

**Files:** Create `tools/contracts.ts`, `tools/contracts.test.ts`.

**Interfaces:** Produces `ContractsRow { date: string; targets: Record<string,number> }`; `readContracts(path)`, `writeContracts(path, rows)`, `upsertContracts(rows, row)`, `topTargets(rows, n): {id:string; count:number}[]` (all-time, desc).

- [ ] **Step 1: Failing test** — `tools/contracts.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readContracts, writeContracts, upsertContracts, topTargets } from './contracts';

describe('contracts-daily', () => {
  it('round-trip + upsert por data', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ct-'));
    const p = join(dir, 'c.json');
    let rows = [{ date: '2026-06-20', targets: { '2:77087': 3 } }];
    rows = upsertContracts(rows, { date: '2026-06-19', targets: { '2:5': 1 } });
    rows = upsertContracts(rows, { date: '2026-06-20', targets: { '2:77087': 9 } }); // substitui
    writeContracts(p, rows);
    expect(readContracts(p).find(r => r.date === '2026-06-20')!.targets['2:77087']).toBe(9);
    rmSync(dir, { recursive: true, force: true });
  });
  it('topTargets soma all-time e ordena desc', () => {
    const rows = [
      { date: '2026-06-19', targets: { '2:77087': 2, '2:5': 1 } },
      { date: '2026-06-20', targets: { '2:77087': 5 } },
    ];
    expect(topTargets(rows, 2)).toEqual([{ id: '2:77087', count: 7 }, { id: '2:5', count: 1 }]);
  });
});
```

- [ ] **Step 2: Run, expect FAIL** — module missing.

- [ ] **Step 3: Implement** `tools/contracts.ts`:

```ts
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

export interface ContractsRow { date: string; targets: Record<string, number>; }

export function readContracts(path: string): ContractsRow[] {
  if (!existsSync(path)) return [];
  try { return JSON.parse(readFileSync(path, 'utf8')) as ContractsRow[]; } catch { return []; }
}
export function writeContracts(path: string, rows: ContractsRow[]): void {
  const sorted = [...rows].sort((a, b) => a.date.localeCompare(b.date));
  writeFileSync(path, JSON.stringify(sorted, null, 0) + '\n');
}
export function upsertContracts(rows: ContractsRow[], row: ContractsRow): ContractsRow[] {
  const out = rows.filter((r) => r.date !== row.date);
  out.push(row);
  return out.sort((a, b) => a.date.localeCompare(b.date));
}
export function topTargets(rows: ContractsRow[], n: number): { id: string; count: number }[] {
  const tot: Record<string, number> = {};
  for (const r of rows) for (const [k, v] of Object.entries(r.targets)) tot[k] = (tot[k] ?? 0) + v;
  return Object.entries(tot).map(([id, count]) => ({ id, count })).sort((a, b) => b.count - a.count).slice(0, n);
}
```

- [ ] **Step 4: Run, expect PASS.**

- [ ] **Step 5: Commit** — `git add tools/contracts.ts tools/contracts.test.ts && git commit -m "feat: contracts-daily.json (alvos não-DIESEL por dia) + topTargets" -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"`

---

### Task 6: `tools/price.ts` — BTC/USD

**Files:** Create `tools/price.ts`, `tools/price.test.ts`.

**Interfaces:** Produces `fetchRange(fromIso, toIso, opts?): Promise<Record<string,number>>` (date→usd) and `fetchDay(dateIso, opts?): Promise<number>`; `opts.fetchImpl` injectable. Parses CoinGecko `market_chart/range` (`{prices:[[ms,usd],...]}`) into one representative price per UTC date.

- [ ] **Step 1: Failing test** — `tools/price.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { fetchRange } from './price';

describe('price.fetchRange', () => {
  it('mapeia prices[ms,usd] do CoinGecko para date->usd (último do dia)', async () => {
    const body = JSON.stringify({ prices: [[1735430400000, 90000], [1735470000000, 95000], [1735516800000, 100000]] });
    const f = (async () => ({ ok: true, status: 200, text: async () => body, json: async () => JSON.parse(body) } as Response)) as unknown as typeof fetch;
    const out = await fetchRange('2024-12-29', '2024-12-30', { fetchImpl: f });
    expect(out['2024-12-29']).toBe(95000); // último ponto do dia 29 (UTC)
    expect(out['2024-12-30']).toBe(100000);
  });
});
```
(Implementer: compute the expected dates/values from the timestamps with `new Date(ms).toISOString().slice(0,10)`; adjust expectations to match.)

- [ ] **Step 2: Run, expect FAIL.**

- [ ] **Step 3: Implement** `tools/price.ts` — call CoinGecko, group `prices` by UTC date keeping the last value per date:

```ts
export interface PriceOpts { fetchImpl?: typeof fetch; }
const CG = 'https://api.coingecko.com/api/v3/coins/bitcoin/market_chart/range';

export async function fetchRange(fromIso: string, toIso: string, opts: PriceOpts = {}): Promise<Record<string, number>> {
  const f = opts.fetchImpl ?? fetch;
  const from = Math.floor(Date.parse(fromIso + 'T00:00:00Z') / 1000);
  const to = Math.floor(Date.parse(toIso + 'T23:59:59Z') / 1000);
  const res = await f(`${CG}?vs_currency=usd&from=${from}&to=${to}`);
  const j = JSON.parse(await res.text()) as { prices?: [number, number][] };
  const byDate: Record<string, number> = {};
  for (const [ms, usd] of j.prices ?? []) byDate[new Date(ms).toISOString().slice(0, 10)] = usd; // last wins
  return byDate;
}
export async function fetchDay(dateIso: string, opts: PriceOpts = {}): Promise<number> {
  const r = await fetchRange(dateIso, dateIso, opts);
  return r[dateIso] ?? 0;
}
```

- [ ] **Step 4: Run, expect PASS.**

- [ ] **Step 5: Commit** — `git add tools/price.ts tools/price.test.ts && git commit -m "feat: tools/price.ts (BTC/USD CoinGecko, range+dia, injetável)" -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"`

---

### Task 7: history — fee/btcUsd columns + fee metrics

**Files:** Modify `tools/history.ts`. Test `tools/history.test.ts`.

**Interfaces:** `HistoryRow`/`Sums` gain `feeTotalSats`,`feeAlkanesSats`,`feeOpReturnSats`,`btcUsd`; `COLS` includes them. New helpers: `feeAlkanesShare(s)`, `feeOpReturnShare(s)`; and `minerRevenueUsdDay(r)` (per-row, uses 144 + subsidy).

- [ ] **Step 1: Failing test** — add to `tools/history.test.ts` (and update the `mk` helper to include the new fields defaulting to 0):

```ts
  it('feeAlkanesShare = feeAlkanesSats / feeTotalSats', () => {
    const s = { blocksScanned:1, totalTx:10, txWithOpReturn:5, txAlkanes:3, opReturnBytes:1, runestoneBytes:1, alkanesBytes:1, dieselMints:1, feeTotalSats:1000, feeAlkanesSats:800, feeOpReturnSats:900, btcUsd:0 };
    expect(feeAlkanesShare(s)).toBeCloseTo(0.8);
    expect(feeOpReturnShare(s)).toBeCloseTo(0.9);
  });
  it('minerRevenueUsdDay = (fees extrapoladas + subsídio) * btcUsd', () => {
    const r = { date:'2026-06-20', fromHeight:1, toHeight:2, blocksScanned:1, totalTx:0, txWithOpReturn:0, txAlkanes:0, opReturnBytes:0, runestoneBytes:0, alkanesBytes:0, dieselMints:0, feeTotalSats:1_000_000, feeAlkanesSats:0, feeOpReturnSats:0, btcUsd:100000 };
    // feeDayBtc = 1_000_000/1*144/1e8 = 1.44 ; +144*3.125=450 ; total 451.44 BTC * 100000
    expect(minerRevenueUsdDay(r)).toBeCloseTo(451.44 * 100000, -2);
  });
```
Add `feeAlkanesShare, feeOpReturnShare, minerRevenueUsdDay` to the import.

- [ ] **Step 2: Run, expect FAIL.**

- [ ] **Step 3: Implement** in `tools/history.ts`:
  - Add the 4 fields to `HistoryRow` (after `dieselMints`) and to `Sums`.
  - Add them to `COLS` array (append the 4 names, same order).
  - In `readHistory` row object, add `feeTotalSats: num('feeTotalSats')` etc. and `btcUsd: num('btcUsd')`.
  - In `rollup`'s `s` init and accumulation, add the three fee sums (NOT btcUsd — price isn't summable; rollup leaves btcUsd 0).
  - Add helpers:
    ```ts
    export const feeAlkanesShare = (s: Sums): number => (s.feeTotalSats ? s.feeAlkanesSats / s.feeTotalSats : 0);
    export const feeOpReturnShare = (s: Sums): number => (s.feeTotalSats ? s.feeOpReturnSats / s.feeTotalSats : 0);
    const SUBSIDY_SATS = 312_500_000;
    export const minerRevenueUsdDay = (r: HistoryRow): number =>
      r.blocksScanned ? ((r.feeTotalSats / r.blocksScanned * 144 + 144 * SUBSIDY_SATS) / 1e8) * r.btcUsd : 0;
    ```

- [ ] **Step 4: Run, expect PASS** — `./node_modules/.bin/vitest run tools/history.test.ts`; then full `npm test`.

- [ ] **Step 5: Commit** — `git add tools/history.ts tools/history.test.ts && git commit -m "feat: colunas fee/btcUsd no history + métricas de receita de miner" -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"`

---

### Task 8: pipelines — seed-history + snapshot write fees, btcUsd, contracts-daily

**Files:** Modify `tools/seed-history.ts`, `tools/snapshot.ts`. (Scripts — verify by running.)

- [ ] **Step 1: seed-history** — in `tools/seed-history.ts`:
  - The `Block` interface's `aggregate` already optional-reads new fields; add `feeTotalSats?`, `feeAlkanesSats?`, `feeOpReturnSats?` to it and a top-level `nonDieselTargets?: Record<string,number>` on `Block`.
  - In the per-date reduce, add the three fee sums (default 0) into the `HistoryRow`, and accumulate per-date `targets` from `b.nonDieselTargets`.
  - After building rows: `import { fetchRange } from './price'` and fill `btcUsd` per row: `const prices = await fetchRange(rows[0].date, rows[rows.length-1].date); for (const r of rows) r.btcUsd = prices[r.date] ?? 0;` (wrap in try/catch → leave 0 on failure).
  - Build `contracts-daily.json` via `tools/contracts.ts` (`writeContracts('contracts-daily.json', contractRows)`).
  - Make the script top-level `await` (it already runs as ESM module entry).

- [ ] **Step 2: snapshot** — in `tools/snapshot.ts`:
  - Add the three fee fields (from `result.aggregate`) and `btcUsd` (from `await fetchDay(row.date)`, try/catch → 0) to the `row`.
  - Upsert today's contracts entry: `upsertContracts(readContracts('contracts-daily.json'), { date: row.date, targets: result.nonDieselTargets })` then `writeContracts(...)`.

- [ ] **Step 3: Verify (local, no network for the parse)** — run a dry seed against the existing cache if present, else defer to the re-scan. At minimum:
  ```bash
  ./node_modules/.bin/tsc --noEmit  # types OK for src/ (tools/ not in include, but check no src breakage)
  npm test                          # all green
  ```
  Expected: tests green; no type regressions in `src/`.

- [ ] **Step 4: Commit** — `git add tools/seed-history.ts tools/snapshot.ts && git commit -m "feat: pipelines escrevem fees, btcUsd e contracts-daily.json" -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"`

---

### Task 9: re-scan (single) to repopulate

**Files:** none (CI).

- [ ] **Step 1: Push** — `git push origin master`.
- [ ] **Step 2: Trigger** — `gh workflow run backfill.yml --repo Vdto88/alkanes-opreturn-scanner --ref master -f from=930000 -f to=955153 -f sample=9 -f concurrency=20 -f merge=true`.
- [ ] **Step 3: Monitor** until terminal; on success it rebuilds `history.csv` (with fees+btcUsd) + `contracts-daily.json`, regenerates the report, publishes.
- [ ] **Step 4: Verify** `history.csv` has populated `feeTotalSats`/`btcUsd` columns; `contracts-daily.json` exists with target maps.

---

### Task 10: 2a report — miner fee revenue (USD+BTC) + fee share

**Files:** Modify `tools/build-report.ts`. (Run+grep verify.)

- [ ] **Step 1: Data** — import `minerRevenueUsdDay`, `feeAlkanesShare`, `feeOpReturnShare`. Add to `data`: `feeUsdDaily: rows.map((r)=>Math.round(minerRevenueUsdDay(r)))` and `feeBtcDaily` (same without `*btcUsd`, in BTC, 2 decimals). Add all-time fee shares from `all`.
- [ ] **Step 2: UI** — add `<h2>Miner fee revenue</h2>` + a `.legend` + `<div class="wrap"><canvas id="f"></canvas></div>`; and a card/note "Alkanes/OP_RETURN = X% of miner fee revenue" using `feeAlkanesShare(all)`/`feeOpReturnShare(all)`.
- [ ] **Step 3: Chart** — add `new Chart(f,{type:'line',data:{labels:D.labels,datasets:[{label:'Miner fee revenue (USD/day)',data:D.feeUsdDaily,borderColor:'#E9A23B',fill:true,backgroundColor:'rgba(233,162,59,0.12)',pointRadius:1,tension:.25,borderWidth:2}]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false},tooltip:{callbacks:{label:c=>'$'+c.parsed.y.toLocaleString('en-US')+' ('+D.feeBtcDaily[c.dataIndex]+' BTC)'}}},scales:{y:{grid:{color:grid},ticks:{callback:v=>'$'+(v/1e6).toFixed(1)+'M'}},x:{grid:{display:false},ticks:{maxRotation:45,autoSkip:true,maxTicksLimit:10}}}}});` (USD axis in $M; tooltip shows BTC).
- [ ] **Step 4: Methodology note** — add a `.note` explaining extrapolation (sample→144 blocks) + subsidy (3.125 BTC) + USD via daily BTC price.
- [ ] **Step 5: Verify** —
  ```bash
  ./node_modules/.bin/tsx tools/build-report.ts
  grep -c 'Miner fee revenue' report.html        # >=2 (heading + dataset)
  grep -o '"feeUsdDaily":\[[^]]*\]' report.html | head -c 40
  node -e 'const fs=require("fs");const h=fs.readFileSync("report.html","utf8");const m=[...h.matchAll(/<script>([\s\S]*?)<\/script>/g)];fs.writeFileSync("ri.tmp.js",m[m.length-1][1]);' && node --check ri.tmp.js && echo OK; rm -f ri.tmp.js
  ```
- [ ] **Step 6: Commit + publish** — commit `tools/build-report.ts report.html`; `git push`; the next daily (or `gh workflow run daily.yml`) publishes. Verify live (cache-busted curl) shows the fee-revenue section.

---

## Self-review checklist (run after writing all tasks)

- Every spec item for 2a mapped? fees capture (T1,T3,T4), price (T6), columns (T7), pipelines (T8), re-scan (T9), report (T10). Target capture for 2b (T2,T4,T5,T8) lands here so re-scan is single. ✓
- No placeholders except the two clearly-flagged fixture-construction notes in T2/T6 (real hex / real timestamps), which the implementer derives locally. ✓
- Type names consistent: `nonDieselTargets` (map), `feeTotalSats`/`feeAlkanesSats`/`feeOpReturnSats`, `btcUsd`, `ContractsRow`, `topTargets`, `fetchRange`/`fetchDay`, `minerRevenueUsdDay`. ✓

## Out of scope → Fase 2b

Top-contracts ranking render (reads `contracts-daily.json` via `topTargets`) + friendly-label map. No new scan.
