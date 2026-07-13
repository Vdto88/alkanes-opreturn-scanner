# Censo do /metrics no GitHub Actions — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Gerar o censo (`blockspace-daily.json`: weight/UG/runestone) no GitHub Actions 24/7, de modo que o `/metrics` avance até o tip todo dia sem depender da WSL do PC.

**Architecture:** Separar histórico imutável (snapshot cru commitado, blocos 880000–951534) do range vivo (ft-d 951535→tip, RocksDB no `actions/cache`). Um `census.yml` no scanner builda o rockshrew-mono (receita da Fase 0, já provada) + o WASM do indexer, restaura o db-ft-d, estende ao tip, e roda o `export-blockspace.ts` concatenando `[snapshot + ft-d]` antes do `bucketByDay`. Fonte de verdade: `docs/superpowers/specs/2026-07-13-censo-ci-automation-design.md`.

**Tech Stack:** GitHub Actions (ubuntu-latest), Rust 1.86 (rockshrew-mono de `kungfuflex/alkanes-rs`), TypeScript/tsx + vitest (tools do indexer), RocksDB 0.21, `node:zlib` (gzip), `actions/cache` + `Swatinem/rust-cache`.

## Global Constraints

- **Fase 0 JÁ CONCLUÍDA** (2026-07-13): build do rockshrew-mono no runner = verde (branch POC `census-ci-derisk`, `.github/workflows/census-derisk.yml`). Receita: deps `clang libclang-dev protobuf-compiler`; `CXXFLAGS="-include cstdint"`; `PROTOC=$(which protoc)`; `cargo build --release -p rockshrew-mono`; toolchain 1.86.0 auto via `rust-toolchain.toml`. ~10min. Reusar essa receita verbatim na Task 4.
- **alkanes-rs:** `https://github.com/kungfuflex/alkanes-rs` (público), rev `888f4fe6f407797a75b11e0074a1ba0e055cd33b`. rockshrew-mono em `crates/rockshrew-mono`.
- **Indexer é PRIVADO** (`Vdto88/alkanes-opreturn-indexer`, branch `main`) → clone no CI exige **deploy key read-only** (secret `INDEXER_DEPLOY_KEY`). Tools em `tools/`, testes vitest `tools/*.test.ts` (`npm test` = `vitest run`).
- **Scanner** (`Vdto88/alkanes-opreturn-scanner`, público, branch `master`): host do `census.yml`, do `blockspace-daily.json`, e do `daily.yml`.
- **Snapshot histórico:** `data/blockspace-snapshot-880000-951534.json.gz` no INDEXER. `BlockRecord[]` CRUS, **71.535 registros exatos** (951534−880000+1), heights 880000..951534 contíguos.
- **Ranges dos 5 DBs do snapshot** (de `refresh-blockspace-fy.sh`): gen-a 880000–904999, gen-b 905000–929999, ft-a 930000–938607, ft-b 938608–947213, ft-c 947214–951534. ft-d = 951535→DHI (vivo).
- **Bound do export = `DHI`** (`metashrew_height` do ft-d no momento do export), NUNCA o `getblockcount` da chain.
- **Secret `CENSUS_RPC_URL`:** endpoint RPC completo (com chave) pro serve do ft-d. Nunca no repo.
- **Cron do census: 04:45 UTC, SEM dispatch** do daily (evita corrida; o daily 06:17 pega o JSON commitado).
- **Cache do db-ft-d:** `actions/cache/restore` + `actions/cache/save` (`if: always()`), key `db-ft-d-${{ github.run_id }}` + `restore-keys: db-ft-d-`.
- Nunca pipar cargo por `| tail`/`| head` (mascara exit code). Nada de `git push -u` com URL-token.

---

### Task 1: `dump-snapshot.ts` + gerar e commitar o snapshot histórico

**Files:**
- Create: `tools/dump-snapshot.ts` (repo indexer)
- Create: `tools/dump-snapshot.test.ts` (repo indexer)
- Reuse: `tools/metashrew-export.ts` (`fetchRange`, `BlockRecord`)
- Produce (commit): `data/blockspace-snapshot-880000-951534.json.gz` (repo indexer)

**Interfaces:**
- Consumes: `fetchRange(url, from, to) => Promise<BlockRecord[]>` e `type BlockRecord` de `./metashrew-export`.
- Produces: `assertContiguous(recs: BlockRecord[], from: number, to: number): void` — usada também na Task 2 como referência de invariante.

- [ ] **Step 1: Write the failing test** — `tools/dump-snapshot.test.ts`

```ts
import { describe, it, expect } from "vitest";
import { assertContiguous } from "./dump-snapshot";
import type { BlockRecord } from "./metashrew-export";

const rec = (height: number): BlockRecord => ({
  height, timestamp: 1_700_000_000 + height, tx_count: 0, tx_with_opreturn: 0,
  tx_alkanes: 0, tx_runes: 0, diesel_mints: 0, opreturn_bytes_total: 0,
  opreturn_bytes_alkanes: 0, opreturn_bytes_runes: 0, total_fee_sats: 0,
  weight_total: 0, weight_alkanes: 0, ug_mints: 0, diesel_ug: 0,
});

describe("assertContiguous", () => {
  it("passa quando [from,to] esta completo e sem gaps", () => {
    const recs = [10, 11, 12, 13].map(rec);
    expect(() => assertContiguous(recs, 10, 13)).not.toThrow();
  });
  it("falha quando falta um bloco (contagem menor)", () => {
    const recs = [10, 11, 13].map(rec);
    expect(() => assertContiguous(recs, 10, 13)).toThrow(/esperava 4/);
  });
  it("falha quando ha bloco duplicado", () => {
    const recs = [10, 11, 11, 12, 13].map(rec);
    expect(() => assertContiguous(recs, 10, 13)).toThrow(/duplicad/);
  });
  it("falha quando min/max nao batem", () => {
    const recs = [11, 12, 13, 14].map(rec);
    expect(() => assertContiguous(recs, 10, 13)).toThrow(/min\/max/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run (no indexer): `npx vitest run tools/dump-snapshot.test.ts`
Expected: FAIL — `Cannot find module './dump-snapshot'` (ou `assertContiguous is not exported`).

- [ ] **Step 3: Write minimal implementation** — `tools/dump-snapshot.ts`

```ts
// One-time (WSL): dumpa os BlockRecord[] CRUS de [from,to] de N fontes servidas -> arquivo gzip.
// Congela o snapshot historico do censo (880000-951534) pro CI nunca re-indexar. Cru (nao por
// dia) pra a fronteira historico<->ft-d nao partir nenhum dia no bucketByDay do export.
import { writeFileSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { fetchRange, type BlockRecord } from "./metashrew-export";

interface Source { url: string; from: number; to: number; }

/** Garante que `recs` cobre EXATAMENTE [from,to] sem gaps nem duplicados (heights contiguos). */
export function assertContiguous(recs: BlockRecord[], from: number, to: number): void {
  const expected = to - from + 1;
  if (recs.length !== expected) {
    throw new Error(`dump-snapshot: esperava ${expected} registros (${from}..${to}), veio ${recs.length}`);
  }
  const heights = recs.map((r) => r.height);
  const seen = new Set(heights);
  if (seen.size !== heights.length) {
    throw new Error(`dump-snapshot: heights duplicados (${heights.length} regs, ${seen.size} unicos)`);
  }
  const min = Math.min(...heights), max = Math.max(...heights);
  if (min !== from || max !== to) {
    throw new Error(`dump-snapshot: min/max height = ${min}/${max}, esperava ${from}/${to}`);
  }
}

async function main() {
  const out = process.argv[2];
  const rest = process.argv.slice(3);
  if (!out || rest.length === 0 || rest.length % 3 !== 0) {
    console.error("uso: tsx tools/dump-snapshot.ts <outPath.json.gz> <url from to> [<url from to> ...]");
    process.exit(1);
  }
  const sources: Source[] = [];
  for (let i = 0; i < rest.length; i += 3) {
    sources.push({ url: rest[i], from: Number(rest[i + 1]), to: Number(rest[i + 2]) });
  }
  const recs: BlockRecord[] = [];
  const CHUNK = 500;
  for (const s of sources) {
    let got = 0;
    for (let h = s.from; h <= s.to; h += CHUNK) {
      const hi = Math.min(h + CHUNK - 1, s.to);
      recs.push(...(await fetchRange(s.url, h, hi)));
      got = recs.length;
    }
    console.error(`  ${s.url} ${s.from}..${s.to}: acumulado ${got} regs`);
  }
  const from = Math.min(...sources.map((s) => s.from));
  const to = Math.max(...sources.map((s) => s.to));
  recs.sort((a, b) => a.height - b.height);
  assertContiguous(recs, from, to);
  const buf = gzipSync(Buffer.from(JSON.stringify(recs), "utf8"));
  writeFileSync(out, buf);
  console.error(`OK: ${recs.length} registros (${from}..${to}) -> ${out} (${buf.length} bytes gzip)`);
}

// Só roda main quando invocado como script (não sob o import do teste).
if (process.argv[1] && process.argv[1].endsWith("dump-snapshot.ts")) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tools/dump-snapshot.test.ts`
Expected: PASS (4 testes).

- [ ] **Step 5: Commit o código (ainda sem o snapshot)**

```bash
git add tools/dump-snapshot.ts tools/dump-snapshot.test.ts
git commit -m "feat(census): dump-snapshot.ts pro snapshot historico cru (com assertContiguous)"
```

- [ ] **Step 6: Gerar o snapshot no WSL** — servir os 5 DBs históricos e dumpar

Servir os 5 DBs primeiro (reusar a mecânica de `run/refresh-blockspace-fy.sh:29-40`, portas 8080–8084, SEM o ft-d) e então:

```bash
# no WSL, com gen-a/b + ft-a/b/c servindo em 8080..8084:
npx tsx tools/dump-snapshot.ts data/blockspace-snapshot-880000-951534.json.gz \
  http://localhost:8080 880000 904999 \
  http://localhost:8081 905000 929999 \
  http://localhost:8082 930000 938607 \
  http://localhost:8083 938608 947213 \
  http://localhost:8084 947214 951534
```
Expected: `OK: 71535 registros (880000..951534) -> ...` e um `.json.gz` de ~2–4 MB. Se a contagem não for 71535, o `assertContiguous` aborta — investigar qual DB não cobriu seu range antes de commitar.

- [ ] **Step 7: Medir e commitar o snapshot**

```bash
ls -la data/blockspace-snapshot-880000-951534.json.gz   # confirmar < ~5 MB
git add data/blockspace-snapshot-880000-951534.json.gz
git commit -m "data(census): snapshot historico congelado 880000-951534 (71535 blocos)"
```

---

### Task 2: `export-blockspace.ts` aceita fonte `file:` (filtro + assert)

**Files:**
- Modify: `tools/export-blockspace.ts` (repo indexer) — loop de fontes (linhas 54-65)
- Modify: `tools/metashrew-export.ts` (repo indexer) — adicionar `readFileSource`
- Modify/Create test: `tools/metashrew-export.test.ts` (repo indexer)

**Interfaces:**
- Consumes: `assertContiguous` (Task 1), `type BlockRecord`, `bucketByDay` (existente).
- Produces: `readFileSource(path: string, from: number, to: number): BlockRecord[]` — lê json(.gz), filtra `[from,to]`, asserta contiguidade; usada pelo `export-blockspace.ts` quando a "url" começa com `file:`.

- [ ] **Step 1: Write the failing test** — adicionar em `tools/metashrew-export.test.ts`

```ts
import { describe, it, expect } from "vitest";
import { writeFileSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readFileSource } from "./metashrew-export";
import type { BlockRecord } from "./metashrew-export";

const rec = (height: number): BlockRecord => ({
  height, timestamp: 1_700_000_000 + height, tx_count: 1, tx_with_opreturn: 0,
  tx_alkanes: 0, tx_runes: 0, diesel_mints: 0, opreturn_bytes_total: 0,
  opreturn_bytes_alkanes: 0, opreturn_bytes_runes: 0, total_fee_sats: 0,
  weight_total: 0, weight_alkanes: 0, ug_mints: 0, diesel_ug: 0,
});

describe("readFileSource", () => {
  it("le um .json.gz e filtra [from,to] exato", () => {
    const p = join(tmpdir(), "snap.json.gz");
    writeFileSync(p, gzipSync(Buffer.from(JSON.stringify([10, 11, 12, 13].map(rec)))));
    const out = readFileSource(p, 10, 13);
    expect(out.map((r) => r.height)).toEqual([10, 11, 12, 13]);
  });
  it("le um .json cru (sem gzip)", () => {
    const p = join(tmpdir(), "snap.json");
    writeFileSync(p, JSON.stringify([10, 11].map(rec)));
    expect(readFileSource(p, 10, 11).length).toBe(2);
  });
  it("aborta se o arquivo tem bloco a mais em [from,to] (sobreposicao dobraria o dia)", () => {
    const p = join(tmpdir(), "snap-extra.json.gz");
    // 10..13 pedidos, mas o arquivo tem 10,11,11,12,13 (11 duplicado) -> apos filtro, 5 != 4
    writeFileSync(p, gzipSync(Buffer.from(JSON.stringify([10, 11, 11, 12, 13].map(rec)))));
    expect(() => readFileSource(p, 10, 13)).toThrow();
  });
  it("aborta se falta bloco em [from,to]", () => {
    const p = join(tmpdir(), "snap-miss.json.gz");
    writeFileSync(p, gzipSync(Buffer.from(JSON.stringify([10, 12, 13].map(rec)))));
    expect(() => readFileSource(p, 10, 13)).toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tools/metashrew-export.test.ts`
Expected: FAIL — `readFileSource is not exported`.

- [ ] **Step 3: Write minimal implementation** — em `tools/metashrew-export.ts` (topo, após os imports existentes adicionar `readFileSync`/`gunzipSync`)

```ts
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";

/**
 * Lê BlockRecord[] de um arquivo (json ou json.gz), FILTRA para height ∈ [from,to] e ASSERTA
 * que a cobertura é exatamente `to-from+1` sem duplicados. Necessário porque o `bucketByDay`
 * só SOMA (não deduplica por height): um bloco a mais no snapshot dobraria silenciosamente as
 * métricas do dia da fronteira. Uma fonte fetchRange já devolve exatamente [from,to]; a fonte
 * `file:` tem que ter a mesma semântica.
 */
export function readFileSource(path: string, from: number, to: number): BlockRecord[] {
  const raw = readFileSync(path);
  const json = path.endsWith(".gz") ? gunzipSync(raw) : raw;
  const all = JSON.parse(json.toString("utf8")) as BlockRecord[];
  const filtered = all.filter((r) => r.height >= from && r.height <= to);
  const expected = to - from + 1;
  const seen = new Set(filtered.map((r) => r.height));
  if (filtered.length !== expected || seen.size !== filtered.length) {
    throw new Error(
      `readFileSource ${path}: apos filtro [${from},${to}] veio ${filtered.length} regs ` +
        `(${seen.size} unicos), esperava ${expected} contiguos`,
    );
  }
  return filtered;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tools/metashrew-export.test.ts`
Expected: PASS (novos 4 + os existentes seguem verdes).

- [ ] **Step 5: Wire no `export-blockspace.ts`** — trocar o loop de fontes (`tools/export-blockspace.ts:54-65`)

```ts
  const recs: BlockRecord[] = [];
  const CHUNK = 500;
  for (const s of sources) {
    if (s.url.startsWith("file:")) {
      const part = readFileSource(s.url.slice("file:".length), s.from, s.to);
      recs.push(...part);
      console.error(`  ${s.url} ${s.from}..${s.to}: ${part.length} regs (arquivo)`);
      continue;
    }
    let got = 0;
    for (let h = s.from; h <= s.to; h += CHUNK) {
      const hi = Math.min(h + CHUNK - 1, s.to);
      const part = await fetchRange(s.url, h, hi);
      recs.push(...part);
      got += part.length;
    }
    console.error(`  ${s.url} ${s.from}..${s.to}: ${got} regs`);
  }
```
E adicionar `readFileSource` ao import de `./metashrew-export` no topo do `export-blockspace.ts`.

- [ ] **Step 6: Run the full suite + commit**

```bash
npm test
git add tools/metashrew-export.ts tools/metashrew-export.test.ts tools/export-blockspace.ts
git commit -m "feat(census): export-blockspace aceita fonte file: (filtro+assert na fronteira)"
```
Expected: suíte inteira verde.

---

### Task 3: Derriscar o build do WASM do indexer + provisionar o deploy key

**Files:**
- Modify: `.github/workflows/census-derisk.yml` (branch `census-ci-derisk` do scanner) — adicionar job `build-wasm`
- Secret (manual): `INDEXER_DEPLOY_KEY` no scanner (chave SSH read-only do indexer)

**Interfaces:**
- Produces: prova de que `opreturn_indexer.wasm` builda no runner + o clone do indexer privado via deploy key funciona (pré-requisito da Task 4).

- [ ] **Step 1: Gerar e instalar o deploy key (manual, one-time)**

```bash
ssh-keygen -t ed25519 -N "" -f census_indexer_key -C "census-ci read-only"
# Chave PÚBLICA -> Settings > Deploy keys do repo Vdto88/alkanes-opreturn-indexer (SEM write access):
gh repo deploy-key add census_indexer_key.pub --repo Vdto88/alkanes-opreturn-indexer --title "census-ci ro"
# Chave PRIVADA -> secret do scanner:
gh secret set INDEXER_DEPLOY_KEY --repo Vdto88/alkanes-opreturn-scanner < census_indexer_key
rm census_indexer_key census_indexer_key.pub
```

- [ ] **Step 2: Adicionar o job `build-wasm` ao `census-derisk.yml`**

```yaml
  build-wasm:
    runs-on: ubuntu-latest
    timeout-minutes: 30
    steps:
      - name: System deps (protoc p/ metashrew-* via protobuf)
        run: sudo apt-get update && sudo apt-get install -y protobuf-compiler

      - name: Setup SSH deploy key (indexer privado)
        run: |
          mkdir -p ~/.ssh && chmod 700 ~/.ssh
          echo "${{ secrets.INDEXER_DEPLOY_KEY }}" > ~/.ssh/id_ed25519
          chmod 600 ~/.ssh/id_ed25519
          ssh-keyscan github.com >> ~/.ssh/known_hosts 2>/dev/null

      - name: Clone indexer (privado, via deploy key)
        run: git clone git@github.com:Vdto88/alkanes-opreturn-indexer.git indexer

      - name: Add wasm32 target
        run: rustup target add wasm32-unknown-unknown

      - name: Cache cargo/target (indexer)
        uses: Swatinem/rust-cache@v2
        with: { workspaces: indexer, cache-on-failure: true }

      - name: Build WASM
        working-directory: indexer
        run: |
          export PROTOC="$(which protoc)"
          cargo build --release --target wasm32-unknown-unknown
          ls -la target/wasm32-unknown-unknown/release/opreturn_indexer.wasm
          echo "=== WASM build OK ==="
```

- [ ] **Step 3: Push e verificar verde**

```bash
git add .github/workflows/census-derisk.yml
git commit -m "ci(derisk): provar build do WASM do indexer no runner"
GIT_TERMINAL_PROMPT=0 git push "https://$(gh auth token)@github.com/Vdto88/alkanes-opreturn-scanner.git" census-ci-derisk
gh run watch "$(gh run list --repo Vdto88/alkanes-opreturn-scanner --branch census-ci-derisk --limit 1 --json databaseId --jq '.[0].databaseId')" --repo Vdto88/alkanes-opreturn-scanner
```
Expected: job `build-wasm` verde, `opreturn_indexer.wasm` presente. Se travar (target/protoc/dep), diagnosticar e re-rodar (o cache guarda progresso). **Gate: verde antes da Task 4.**

---

### Task 4: `census.yml` completo (no scanner)

**Files:**
- Create: `.github/workflows/census.yml` (repo scanner, na `master`)
- Depends: snapshot (Task 1), `file:` (Task 2), deploy key + WASM/rockshrew provados (Task 3 + Fase 0)

**Interfaces:**
- Consumes: secrets `INDEXER_DEPLOY_KEY`, `CENSUS_RPC_URL`; artefato `data/blockspace-snapshot-880000-951534.json.gz` do indexer.
- Produces: commit de `blockspace-daily.json` na `master` do scanner, todo dia.

- [ ] **Step 1: Criar o secret `CENSUS_RPC_URL`**

```bash
gh secret set CENSUS_RPC_URL --repo Vdto88/alkanes-opreturn-scanner   # cola a URL RPC completa (com chave)
```

- [ ] **Step 2: Escrever `.github/workflows/census.yml`**

```yaml
name: census (metashrew blockspace)

on:
  schedule:
    - cron: '45 4 * * *'   # 04:45 UTC, ANTES do daily.yml (06:17). Sem dispatch do daily.
  workflow_dispatch: {}

permissions:
  contents: write

concurrency:
  group: census
  cancel-in-progress: false

jobs:
  census:
    runs-on: ubuntu-latest
    timeout-minutes: 120
    steps:
      - name: Checkout scanner
        uses: actions/checkout@v4

      - name: System deps (rockshrew + wasm + protoc)
        run: |
          sudo apt-get update
          sudo apt-get install -y clang libclang-dev protobuf-compiler

      - name: SSH deploy key (indexer privado)
        run: |
          mkdir -p ~/.ssh && chmod 700 ~/.ssh
          echo "${{ secrets.INDEXER_DEPLOY_KEY }}" > ~/.ssh/id_ed25519
          chmod 600 ~/.ssh/id_ed25519
          ssh-keyscan github.com >> ~/.ssh/known_hosts 2>/dev/null

      - name: Clone indexer (privado) + alkanes-rs (publico)
        run: |
          git clone git@github.com:Vdto88/alkanes-opreturn-indexer.git indexer
          git clone https://github.com/kungfuflex/alkanes-rs.git alkanes-rs
          git -C alkanes-rs checkout 888f4fe6f407797a75b11e0074a1ba0e055cd33b

      - name: Setup Node
        uses: actions/setup-node@v4
        with: { node-version: 20 }

      - name: Install indexer deps (tsx)
        working-directory: indexer
        run: npm install --no-audit --no-fund

      - name: Rust wasm32 target
        run: rustup target add wasm32-unknown-unknown

      - name: Cache rockshrew build
        uses: Swatinem/rust-cache@v2
        with: { workspaces: alkanes-rs, key: rockshrew-888f4fe6, cache-on-failure: true }

      - name: Build rockshrew-mono (receita da Fase 0)
        working-directory: alkanes-rs
        run: |
          export CXXFLAGS="-include cstdint"
          export PROTOC="$(which protoc)"
          cargo build --release -p rockshrew-mono
          cp target/release/rockshrew-mono "$HOME/rockshrew-mono"

      - name: Cache WASM build
        uses: Swatinem/rust-cache@v2
        with: { workspaces: indexer, key: wasm-indexer, cache-on-failure: true }

      - name: Build WASM
        working-directory: indexer
        run: |
          export PROTOC="$(which protoc)"
          cargo build --release --target wasm32-unknown-unknown

      - name: Restore db-ft-d cache
        uses: actions/cache/restore@v4
        with:
          path: db-ft-d
          key: db-ft-d-${{ github.run_id }}
          restore-keys: db-ft-d-

      - name: Serve ft-d + estender ao tip
        id: serve
        env:
          CENSUS_RPC_URL: ${{ secrets.CENSUS_RPC_URL }}
        run: |
          WASM=indexer/target/wasm32-unknown-unknown/release/opreturn_indexer.wasm
          # rockshrew-mono le a porta da env PORT (mesmo mecanismo do refresh-blockspace-fy.sh).
          PORT=8085 "$HOME/rockshrew-mono" \
            --daemon-rpc-url "$CENSUS_RPC_URL" --indexer "$WASM" \
            --db-path db-ft-d --start-block 951535 \
            --pipeline-size 8 --max-reorg-depth 6 > rockshrew.log 2>&1 &
          echo $! > rockshrew.pid
          hreq='{"jsonrpc":"2.0","id":0,"method":"metashrew_height","params":[]}'
          creq='{"jsonrpc":"2.0","id":0,"method":"getblockcount","params":[]}'
          ht(){ curl -s -m 8 -X POST -H 'Content-Type: application/json' -d "$hreq" http://localhost:8085 | grep -oE '[0-9]+' | tail -1; }
          tip(){ curl -s -m 8 -X POST -H 'Content-Type: application/json' -d "$creq" "$CENSUS_RPC_URL" | grep -oE '"result":[0-9]+' | grep -oE '[0-9]+'; }
          for i in $(seq 1 90); do
            H=$(ht); H=${H:-0}; T=$(tip)
            echo "  ft-d=$H tip=$T"
            [ -z "$T" ] && { echo "tip indisponivel, exporto com ft-d=$H"; break; }
            [ "$H" -ge "$((T-2))" ] && { echo "caught up"; break; }
            sleep 20
          done
          DHI=$(ht); echo "dhi=${DHI:-951535}" >> "$GITHUB_OUTPUT"

      - name: Export blockspace-daily.json
        run: |
          npx --prefix indexer tsx indexer/tools/export-blockspace.ts blockspace-daily.json \
            file:indexer/data/blockspace-snapshot-880000-951534.json.gz 880000 951534 \
            http://localhost:8085 951535 ${{ steps.serve.outputs.dhi }}

      - name: Kill rockshrew (antes de salvar o cache)
        if: always()
        run: |
          [ -f rockshrew.pid ] && kill "$(cat rockshrew.pid)" 2>/dev/null || true
          for i in $(seq 1 15); do pgrep -x rockshrew-mono >/dev/null || break; sleep 2; done

      - name: Save db-ft-d cache
        if: always()
        uses: actions/cache/save@v4
        with:
          path: db-ft-d
          key: db-ft-d-${{ github.run_id }}

      - name: Commit blockspace-daily.json
        run: |
          git config user.name "github-actions[bot]"
          git config user.email "github-actions[bot]@users.noreply.github.com"
          git add blockspace-daily.json
          git pull --rebase --autostash origin master || true
          git diff --cached --quiet || git commit -m "chore(census): blockspace-daily $(date -u +%Y-%m-%d)"
          git push
```

- [ ] **Step 3: Commit o workflow**

```bash
git add .github/workflows/census.yml
git commit -m "feat(census): workflow census.yml (metashrew blockspace no CI, 04:45 UTC)"
git pull --rebase --autostash origin master
git push
```
(Sem `-u`; push via `https://$(gh auth token)@...` conforme Global Constraints.)

---

### Task 5: Run e2e + verificar o /metrics avançando sozinho

**Files:** nenhum (validação).

- [ ] **Step 1: Disparar o census manualmente**

```bash
gh workflow run census.yml --repo Vdto88/alkanes-opreturn-scanner
gh run watch "$(gh run list --repo Vdto88/alkanes-opreturn-scanner --workflow census.yml --limit 1 --json databaseId --jq '.[0].databaseId')" --repo Vdto88/alkanes-opreturn-scanner
```
Expected: verde; passo Export loga `71535 + N regs` e span terminando no dia de hoje; um commit `chore(census): blockspace-daily ...` na master.

- [ ] **Step 2: Confirmar a fronteira (nenhum dia dobrado)**

Baixar o `blockspace-daily.json` do commit e checar que o dia que contém a fronteira 951534/951535 tem `blocksScanned` plausível (não ~2×). O assert do `readFileSource` já garante, mas conferir o valor.

- [ ] **Step 3: Confirmar o /metrics avança pelo pipeline diário**

Após o próximo `daily.yml` (06:17 UTC) — ou disparando `gh workflow run daily.yml` — e a sync do site:
```bash
curl -s https://subfrost.io/metrics | grep -o "Last day[^<]*"
```
Expected: `Last day` = ontem/hoje, sem ter tocado no PC.

- [ ] **Step 4: Limpeza**

```bash
git push "https://$(gh auth token)@github.com/Vdto88/alkanes-opreturn-scanner.git" --delete census-ci-derisk   # branch POC descartavel
```

---

## Self-Review

**Spec coverage:** C1 snapshot cru → Task 1. C2 db-ft-d cache (restore + save-always + key rotativa) → Task 4 steps. C3 census.yml (12 passos) → Task 4. C4 export `file:` filtro+assert → Task 2. C5 serve rockshrew direto (sem index.sh) → Task 4 "Serve ft-d". Fase 0 build rockshrew → Global Constraints (feita). Ordenação cron 04:45 sem dispatch → Task 4 `on.schedule`. Secret CENSUS_RPC_URL → Task 4 step 1. **Gap coberto além do spec:** indexer privado → deploy key (Task 3); build do WASM (2º desconhecido) → derisking na Task 3.

**Type consistency:** `assertContiguous(recs, from, to)` (Task 1) e `readFileSource(path, from, to)` (Task 2) usam o mesmo `BlockRecord` de `metashrew-export.ts`. O `export-blockspace.ts` importa `readFileSource` do mesmo módulo. O bound do export usa `steps.serve.outputs.dhi` (= `metashrew_height`), coerente com o Global Constraint.

**Placeholder scan:** sem TBD/TODO; todo step de código tem código completo; comandos com expected output.

**Riscos residuais a validar na execução (não placeholders — verificações reais):** (a) o rockshrew-mono lê mesmo a porta de `PORT` env (assumido do `refresh-blockspace-fy.sh`; confirmar no primeiro run da Task 4 — se não, achar a flag `--port`); (b) o `getblockcount` responde no mesmo endpoint RPC do serve (o `refresh-fy` usa endpoints separados; se o `CENSUS_RPC_URL` não servir `getblockcount`, usar `metashrew_height` de um par ou aceitar o fallback "tip indisponivel").

## Execution Handoff

**Plano salvo em `docs/superpowers/plans/2026-07-13-censo-ci-automation.md`.** Fase 0 já verde. Ordem recomendada: Task 1 → 2 (código TS, TDD, no indexer) → 3 (deploy key + derisk WASM, gate) → 4 (census.yml) → 5 (e2e). Execução via **superpowers:subagent-driven-development** (subagent fresco por task, review entre tasks) — com a ressalva de que as Tasks 1 (serve WSL) e 5 (verificação live) têm passos manuais/interativos que o operador roda.
