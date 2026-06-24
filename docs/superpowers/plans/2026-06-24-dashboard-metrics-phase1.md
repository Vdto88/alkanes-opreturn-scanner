# Dashboard Metrics — Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add three dashboard metrics that need NO re-scan — OP_RETURN penetration (% of all BTC tx carrying an OP_RETURN), a toggleable daily Runes line, and a daily "Alkanes excl. DIESEL" line — all derived from columns already in `history.csv`.

**Architecture:** One pure helper added to `tools/history.ts` (TDD-tested), then `tools/build-report.ts` consumes it plus existing share helpers to render a new card, three new chart lines, and checkbox toggles. No changes to the scanner, no new `history.csv` columns, no re-backfill.

**Tech Stack:** TypeScript (ESM), `tsx`, `vitest`, Chart.js 4.4.1 (CDN, already used). Windows + Git Bash for git.

## Global Constraints

- Phase 1 uses ONLY existing `history.csv` columns (`totalTx`, `txWithOpReturn`, `txAlkanes`, `dieselMints`, `runestoneBytes`, `opReturnBytes`, `alkanesBytes`) — no re-scan.
- All existing tests must keep passing: `npm test` is currently **30 passing**; Task 1 adds one → **31**.
- NEVER commit the subfrost key — run `git diff | grep 3cdaa58a` before any commit; expect no match. The key lives only in gitignored `.env.local`.
- Match existing code style: helpers in `history.ts` are one-line `export const name = (s: Sums): number => ...`; report colors use the CSS vars `--teal #2DBE8E`, `--purple #9d94e8`, `--amber #E9A23B`, `--faint #6f6f78`.
- Commit messages in Portuguese, matching repo history; end each with the `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>` trailer.
- `report.html` is generated; the daily workflow (`daily.yml`, 06:17 UTC) regenerates and publishes it. Do not hand-edit `report.html`.

---

## File Structure

- `tools/history.ts` — add `alkExDieselShareCount(s: Sums): number` next to the other share helpers.
- `tools/history.test.ts` — add one test for the new helper.
- `tools/build-report.ts` — import the new + existing helpers, add data series, a new card, three chart datasets, and the toggle UI/JS.

`build-report.ts` is a generator script (top-level execution, writes `report.html`); the repo has no unit test for it (only `tools/history.test.ts` exists under `tools/`). So its tasks are verified by **running it and grepping the generated `report.html`**, not by vitest.

---

### Task 1: `alkExDieselShareCount` helper

**Files:**
- Modify: `tools/history.ts` (add export after `dieselShareCount`, currently line 89)
- Test: `tools/history.test.ts`

**Interfaces:**
- Consumes: `Sums` type and its fields `txAlkanes`, `dieselMints`, `totalTx` (already in `tools/history.ts`).
- Produces: `alkExDieselShareCount(s: Sums): number` — fraction (0..1) of all tx that are Alkanes but NOT DIESEL mints.

- [ ] **Step 1: Write the failing test**

Add to `tools/history.test.ts`, inside the `describe('history csv', ...)` block, after the `rollup` test. Also add `alkExDieselShareCount` to the import on line 5:

```ts
  it('alkExDieselShareCount = (txAlkanes − dieselMints) / totalTx', () => {
    const s = {
      blocksScanned: 1, totalTx: 200, txWithOpReturn: 50, txAlkanes: 80,
      opReturnBytes: 100, runestoneBytes: 90, alkanesBytes: 90, dieselMints: 50,
    };
    expect(alkExDieselShareCount(s)).toBeCloseTo(0.15); // (80 − 50) / 200
  });
```

Import line 5 becomes:

```ts
import { readHistory, writeHistory, upsert, rollup, alkShareCount, alkBytesShare, alkExDieselShareCount, type HistoryRow } from './history';
```

- [ ] **Step 2: Run test to verify it fails**

Run: `./node_modules/.bin/vitest run tools/history.test.ts`
Expected: FAIL — `alkExDieselShareCount is not a function` (or import error).

- [ ] **Step 3: Write minimal implementation**

In `tools/history.ts`, add immediately after the `dieselShareCount` line (line 89):

```ts
// Alkanes que NÃO são mint de DIESEL (a diversidade real do protocolo), como % de todas as tx
export const alkExDieselShareCount = (s: Sums): number => (s.totalTx ? Math.max(0, s.txAlkanes - s.dieselMints) / s.totalTx : 0);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `./node_modules/.bin/vitest run tools/history.test.ts`
Expected: PASS. Then `npm test` → **31 passing**.

- [ ] **Step 5: Commit**

```bash
cd /c/OpDecoder/opreturn-scanner
git diff | grep 3cdaa58a || echo "no key"   # must print "no key"
git add tools/history.ts tools/history.test.ts
git commit -m "feat: helper alkExDieselShareCount (Alkanes não-DIESEL como % das tx)" -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: OP_RETURN penetration — card + daily line

**Files:**
- Modify: `tools/build-report.ts` (imports line 2-5; data object line 47-56; cards HTML line 80-85; daily legend line 89; chart `#g` datasets line 112-114)

**Interfaces:**
- Consumes: `opReturnShare(s: Sums): number` (already exported from `tools/history.ts`, line 88); `sumsOfRow`, `r1`, `all`, `d30`, `data`, chart var `g` (all already in `build-report.ts`).
- Produces: `data.opReturnDaily: number[]` (daily OP_RETURN penetration %, one per row); a 5th metric card; a dashed faint line (dataset index 2) on chart `#g`.

- [ ] **Step 1: Add `opReturnShare` to the import**

In `tools/build-report.ts`, change the import block (lines 2-5) to include `opReturnShare`:

```ts
import {
  readHistory, rollup, alkShareCount, alkBytesShare, opReturnShare, dieselShareCount, runesBytesShare, otherBytesShare,
  utcDate, type HistoryRow, type Sums,
} from './history';
```

- [ ] **Step 2: Add the daily penetration series to `data`**

In the `const data = { ... }` object (line 47-56), add after the `dieselDaily` line:

```ts
  opReturnDaily: rows.map((r) => r1(opReturnShare(sumsOfRow(r)))),
```

- [ ] **Step 3: Add the penetration card**

In the cards block (lines 80-85), add a 5th card after the `All time` card line:

```html
  <div class="card"><div class="l">OP_RETURN penetration</div><div class="v">${r1(opReturnShare(all))}%</div><div class="b">${r1(opReturnShare(d30))}% last 30 days</div></div>
```

- [ ] **Step 4: Add the penetration line to the daily legend and chart**

In the "Daily Alkanes share" HTML legend (line 89), add a span before the closing `</div>`:

```html
<span><span class="sw" style="background:var(--faint)"></span>OP_RETURN penetration</span>
```

In the `new Chart(g,{...})` datasets array (lines 112-114), add a third dataset after the `Transactions` dataset:

```js
 {label:'OP_RETURN penetration',data:D.opReturnDaily,borderColor:'#6f6f78',borderDash:[4,3],fill:false,pointRadius:1.5,tension:.25,borderWidth:2}
```

(It becomes dataset index 2 — Task 3 references that index for the toggle.)

- [ ] **Step 5: Regenerate and verify**

Run:
```bash
cd /c/OpDecoder/opreturn-scanner
./node_modules/.bin/tsx tools/build-report.ts
grep -c "OP_RETURN penetration" report.html   # expect 2 (card + legend)
grep -o '"opReturnDaily":\[[0-9.,]*\]' report.html | head -c 60   # expect a numeric array
```
Expected: `grep -c` prints `2`; the `opReturnDaily` array is present and numeric.
Optional manual check: open `report.html` in a browser — a faint dashed line and the new card appear.

- [ ] **Step 6: Commit**

```bash
git diff | grep 3cdaa58a || echo "no key"   # must print "no key"
git add tools/build-report.ts report.html
git commit -m "feat: card + linha diária de OP_RETURN penetration (% das tx do BTC com OP_RETURN)" -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: Runes (toggle) + Alkanes-excl-DIESEL lines

**Files:**
- Modify: `tools/build-report.ts` (data object; daily legend line 89; chart `#g` block; add a toggle-checkbox row + bind script)

**Interfaces:**
- Consumes: `runesBytesShare` (already imported), `alkExDieselShareCount` (Task 1), `sumsOfRow`, `r1`, chart `#g` (datasets 0 bytes, 1 tx, 2 penetration from Task 2).
- Produces: `data.runesDaily` and `data.alkExDieselDaily` series; datasets index 3 (Runes, amber) and 4 (Alkanes excl. DIESEL, cyan) on `#g`; three checkboxes (`tgPen`, `tgRunes`, `tgAlkEx`) that toggle dataset visibility. All three default checked/visible.

- [ ] **Step 1: Add the two daily series to `data`**

In the `const data = { ... }` object, add after the `opReturnDaily` line (from Task 2):

```ts
  runesDaily: rows.map((r) => r1(runesBytesShare(sumsOfRow(r)))),
  alkExDieselDaily: rows.map((r) => r1(alkExDieselShareCount(sumsOfRow(r)))),
```

- [ ] **Step 2: Add the two lines to the daily legend**

In the "Daily Alkanes share" HTML legend (line 89), add two spans before the closing `</div>`:

```html
<span><span class="sw" style="background:var(--amber)"></span>Runes (bytes)</span><span><span class="sw" style="background:#4bb8d9"></span>Alkanes excl. DIESEL (tx)</span>
```

- [ ] **Step 3: Add a checkbox toggle row above the chart**

Immediately before `<div class="wrap"><canvas id="g"></canvas></div>` (line 90), insert:

```html
<div class="legend" style="margin-bottom:6px">
  <label><input type="checkbox" id="tgPen" checked> OP_RETURN penetration</label>
  <label><input type="checkbox" id="tgRunes" checked> Runes</label>
  <label><input type="checkbox" id="tgAlkEx" checked> Alkanes excl. DIESEL</label>
</div>
```

- [ ] **Step 4: Add the two datasets and capture the chart reference + bind toggles**

In the `new Chart(g,{...})` call, (a) capture the chart in a const, and (b) add the two datasets after the `OP_RETURN penetration` dataset (from Task 2). Change `new Chart(g,{type:'line',...` to `const gChart=new Chart(g,{type:'line',...`, and append to the datasets array:

```js
 ,{label:'Runes (bytes)',data:D.runesDaily,borderColor:'#E9A23B',fill:false,pointRadius:1.5,tension:.25,borderWidth:2}
 ,{label:'Alkanes excl. DIESEL (tx)',data:D.alkExDieselDaily,borderColor:'#4bb8d9',borderDash:[4,3],fill:false,pointRadius:1.5,tension:.25,borderWidth:2}
```

Then, right after the chart `g` is created (after its closing `});`), add the bind logic:

```js
[['tgPen',2],['tgRunes',3],['tgAlkEx',4]].forEach(([id,idx])=>{const el=document.getElementById(id);el.addEventListener('change',()=>{gChart.setDatasetVisibility(idx,el.checked);gChart.update();});});
```

- [ ] **Step 5: Regenerate and verify**

Run:
```bash
cd /c/OpDecoder/opreturn-scanner
./node_modules/.bin/tsx tools/build-report.ts
grep -c "tgRunes" report.html        # expect 2 (checkbox + bind)
grep -o '"runesDaily":\[[0-9.,]*\]' report.html | head -c 50   # numeric array
grep -o '"alkExDieselDaily":\[[0-9.,]*\]' report.html | head -c 50   # numeric array
grep -c "setDatasetVisibility" report.html   # expect 1
```
Expected: `tgRunes` count `2`; both arrays numeric; `setDatasetVisibility` present.
Manual check: open `report.html`, confirm 5 lines render and unchecking "Runes" hides the amber line (and re-checking restores it).

- [ ] **Step 6: Commit**

```bash
git diff | grep 3cdaa58a || echo "no key"   # must print "no key"
git add tools/build-report.ts report.html
git commit -m "feat: linhas de Runes (toggle) e Alkanes-sem-DIESEL no gráfico diário" -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Final verification (after all tasks)

- [ ] `npm test` → **31 passing**, output pristine.
- [ ] `./node_modules/.bin/tsx tools/build-report.ts` runs clean; `report.html` has the new card, 5 daily lines, and 3 toggles.
- [ ] `git push origin master` — the next daily run (or a manual `gh workflow run daily.yml`) publishes the updated dashboard. To publish immediately: `gh workflow run daily.yml --repo Vdto88/alkanes-opreturn-scanner --ref master`.

## Notes for Phase 2 (separate plan, later)

Fees/miners (USD+BTC) needs new `history.csv` columns (`feeTotalSats`, `feeAlkanesSats`, `feeOpReturnSats`, `btcUsd`), fee parsing in `esplora.ts`/`scan.ts`/`metrics.ts`, a `tools/price.ts` (CoinGecko), and a **re-backfill** (the cache holds only aggregates, not per-tx fees). See the spec, section "Fase 2".
