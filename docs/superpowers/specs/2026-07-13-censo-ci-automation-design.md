# Design — Censo do /metrics no GitHub Actions (24/7)

**Data:** 2026-07-13
**Status:** design aprovado pelo usuário ("faz sentido sim"). Spec **revisado pelo Fable** (2026-07-13) e corrigido — 6 findings IMPORTANT + NITs incorporados. Próximo passo = `writing-plans`.

## Contexto

As colunas **weight / UNCOMMON•GOODS / runestone-tx** do `blockspace-daily.json` (o "censo") saem do
**indexer metashrew** (`rockshrew-mono` + WASM `opreturn_indexer.wasm`) rodando na **WSL do PC do Vitor,
à mão**. O **scanner** (colunas 1–15 do `history.csv`) já roda 24/7 no GitHub Actions (`daily.yml`) e
nunca falha; a assimetria é que só o censo depende do PC. Resultado: quando o PC reinicia/dorme o censo
**recongela** (congelou em 08/jul; destampei à mão até 13/jul rodando `refresh-blockspace-fy.sh`).
Diagnóstico completo do congelamento na memória `metrics-opreturn-charts-live`.

**Objetivo:** mover a geração do censo pra **mesma casa 24/7 do scanner (GitHub Actions)**, de modo que o
`blockspace-daily.json` avance até o tip todo dia **sem tocar no PC**, e o `/metrics` pare de recongelar.

## Visão geral do design

**Ideia central: separar o histórico imutável do recente que muda.**

```
                          ┌─ SNAPSHOT HISTÓRICO (arquivo commitado, 880000–951534) ─┐
BlockRecord[] crus  ──────┤                                                          ├──► concat
                          └─ ft-d ao vivo (RocksDB no cache do Actions, 951535→DHI) ─┘        │
                                                                                              ▼
                                                              export-blockspace.ts → bucketByDay
                                                                                              │
                                                                                              ▼
                                                              blockspace-daily.json (scanner) → daily.yml → /metrics
```

O `export-blockspace.ts` **concatena os `BlockRecord` crus de todas as fontes ANTES do `bucketByDay`**
(porque o indexer data por `block.header.time`, não-monotônico). Por isso a fronteira histórico↔ft-d
(bloco 951534/951535) **não parte nenhum dia** — desde que cada fonte devolva EXATAMENTE seu range
(ver C4: filtro + assert; `bucketByDay` só soma, não deduplica por height).

## Repos e artefatos (ref)

- **Scanner:** `Vdto88/alkanes-opreturn-scanner` (`C:\OpDecoder\opreturn-scanner`, branch `master`) —
  onde vive o `daily.yml`, o `blockspace-daily.json` e (novo) o `census.yml`.
- **Indexer:** `Vdto88/alkanes-opreturn-indexer` (`C:\OpDecoder\opreturn-indexer`) — código Rust do
  metashrew, `run/index.sh`, `tools/export-blockspace.ts`, `tools/metashrew-export.ts`.
- **rockshrew-mono:** buildado de `/mnt/c/refs/alkanes-rs` @ rev pinado `888f4fe6`
  (`CARGO_TARGET_DIR=$HOME/rockshrew-target CXXFLAGS="-include cstdint" cargo build --release -p rockshrew-mono`).
- **Endpoints RPC:** `run/endpoints.txt` (gitignored, 5 chaves QuickNode/GetBlock).

### Ranges dos DBs (do `refresh-blockspace-fy.sh:31-36`)

| DB     | portas | range           | muda? |
|--------|--------|-----------------|-------|
| gen-a  | 8080   | 880000–904999   | não   |
| gen-b  | 8081   | 905000–929999   | não   |
| ft-a   | 8082   | 930000–938607   | não   |
| ft-b   | 8083   | 938608–947213   | não   |
| ft-c   | 8084   | 947214–951534   | não   |
| **ft-d** | 8085 | **951535→DHI**  | **sim** |

Snapshot histórico = **880000–951534** (gen-a/b + ft-a/b/c, 5 DBs) = **71.535 registros**
(951534 − 880000 + 1). ft-d = **951535→DHI** (`DHI` = altura indexada corrente do ft-d, a única fonte
viva).

## Componentes

### C1 — Snapshot histórico congelado (arquivo commitado)

- **Conteúdo:** `BlockRecord[]` CRUS dos blocos 880000–951534 (NÃO agregados por dia — crus, pra
  fronteira não partir dia). **71.535 registros exatos.**
- **Formato/local:** `data/blockspace-snapshot-880000-951534.json.gz` **no repo indexer** (coeso com o
  `export-blockspace.ts` que o lê; o `census.yml` já clona o indexer). JSON gzip (`node:zlib`), estimado
  ~2–4 MB comprimido (bem abaixo do limite de 100 MB/arquivo do GitHub). Imutável: gerado UMA vez,
  commitado, o CI nunca re-indexa isso.
- **Como gerar (one-time, no WSL):** novo `tools/dump-snapshot.ts` — serve os 5 DBs (reusa a lógica de
  serve do `refresh-blockspace-fy.sh`, portas 8080–8084), faz `fetchRange` de cada range, concatena os
  `BlockRecord[]`, **asserta contagem = 71.535 e min/max de height = 880000/951534** (falha alto se
  divergir), `gzipSync` → escreve o arquivo. Roda no PC uma vez, commita.

### C2 — DB do ft-d no cache do Actions

- **`actions/cache`** guarda um único RocksDB (`opreturn-db-ft-d`) cobrindo 951535→DHI entre runs.
- **Actions SEPARADAS `actions/cache/restore` (início) + `actions/cache/save` (`if: always()`, após o
  kill do rockshrew).** NÃO usar o `actions/cache` combinado: o save dele roda num post-step que por
  default só executa no sucesso do job → um export falho jogaria fora o progresso de indexação do ft-d.
- **Strategy de key rotativa** (RocksDB muda todo run; cache do Actions é write-once por key):
  `key: db-ft-d-${{ github.run_id }}` + `restore-keys: | db-ft-d-` (restaura o mais recente, salva um
  novo). LRU do Actions evicta os antigos dentro do orçamento de ~10 GB/repo.
- **Fallback resumível (cache perdido):** re-indexa de 951535. Como o save é `if: always()`, cada run
  avança e salva o progresso → o re-index **converge em N runs** mesmo que não caiba num run só (o job do
  Actions tem teto duro de 6h). Sem isso o pipeline bricaria se o db-ft-d ficar grande.
- **Lifecycle (nota, não implementar agora):** ft-d cresce ~144 blocos/dia — em ~1 ano ~52k blocos. Se
  passar de um limiar (medir no derisking), aplica-se a MESMA manobra do design: congela 951535→Y num
  `snapshot-2` e nasce um `ft-e`. Repetível. Deixar escrito pra não virar surpresa.
- **⚠️ medir o tamanho do db-ft-d COM o rockshrew parado** (`du` deu 0 durante a sessão porque os DBs
  estavam locked/servindo): `wsl bash -c "pkill -x rockshrew-mono; sleep 3; du -sh ~/opreturn-db-ft-d"`.

### C3 — Workflow `census.yml` (novo, no repo scanner, junto do `daily.yml`)

Cron diário **cedo (04:45 UTC), sem dispatch** (ver "Ordenação"). `permissions: contents: write`.
`timeout-minutes` explícito (ex.: 120 em regime; maior no derisking — um catch-up travado não pode
queimar 6h de runner). Passos:

1. **Checkout** scanner (`contents: write`, pra commitar o `blockspace-daily.json`).
2. **Clone** indexer como sibling (`../opreturn-indexer`) — igual o `daily.yml` clona o decoder.
3. **Clone** `alkanes-rs` @ `888f4fe6` como sibling — pra buildar o rockshrew-mono.
4. **Cache do binário rockshrew-mono** (`key` = runner-OS + rev `888f4fe6`). Miss → `apt-get install`
   das deps (libclang/clang), build com `CXXFLAGS="-include cstdint"`.
5. **Cache/build do WASM** `opreturn_indexer.wasm` (`key` = rev do indexer + `Cargo.lock`). Miss →
   rustup target `wasm32-unknown-unknown` + PROTOC + `cargo build --release --target wasm32-unknown-unknown`.
6. **`actions/cache/restore`** do `db-ft-d` (C2).
7. **Setup Node 20** + `npm install` no indexer (pro `tsx`).
8. **Servir ft-d e estender ao tip (via C5, NÃO o `index.sh` cru):** subir o `rockshrew-mono` em
   background com args explícitos (`--daemon-rpc-url $CENSUS_RPC_URL --indexer <wasm> --db-path <db-ft-d>
   --start-block 951535`); loop esperando `metashrew_height(8085) >= getblockcount − 2` (mesma lógica do
   `refresh-blockspace-fy.sh:43-50`, incluindo o fallback "tip indisponível → exporta com o que tem").
9. **Export:** capturar `DHI = metashrew_height(8085)` no momento do export e rodar
   `npx tsx tools/export-blockspace.ts <scanner>/blockspace-daily.json
   file:data/blockspace-snapshot-880000-951534.json.gz 880000 951534
   http://localhost:8085 951535 <DHI>` (bound = `DHI`, a altura INDEXADA — não o tip da chain;
   `refresh-blockspace-fy.sh:51` faz exatamente isso, senão pede ao `stats_range` blocos ainda não
   indexados). O `tsx` roda com cwd = raiz do repo indexer, então o `file:data/...` resolve lá (ver C4).
10. **Kill do rockshrew + wait** (espelhar o `killall_wait` do `refresh-fy`, SIGTERM basta) — ANTES de
    salvar o cache, senão o tar empacota um RocksDB com writer vivo (WAL no meio, `LOCK` ativo).
11. **`actions/cache/save`** do `db-ft-d` (`if: always()`, key = `db-ft-d-${{ github.run_id }}`).
12. **Commit** `blockspace-daily.json` no scanner: `git pull --rebase --autostash origin master` →
    `git diff --cached --quiet || git commit ...` (guard de commit vazio, como `daily.yml:100`) → push.
    O `daily.yml` não toca no `blockspace-daily.json`, então o rebase é sempre limpo.

**Secret:** `CENSUS_RPC_URL` (endpoint RPC completo com chave, pra indexar os ~144 blocos/dia do ft-d) →
**GitHub Secrets, NUNCA no repo público.** Guardar a URL *completa* como secret faz o masking do Actions
cobrir qualquer eco em log do rockshrew. Preferir um RPC hospedado (QuickNode/GetBlock).

### C4 — Código: `tools/export-blockspace.ts` lê fonte de arquivo (com filtro + assert)

Estender a interface de triplas `<url from to>` pra aceitar **`file:<path>`** como "url":
- Quando a url começa com `file:` → ler o arquivo (`gunzipSync` se `.gz`), `JSON.parse` → `BlockRecord[]`.
- **FILTRAR** os registros pra `height ∈ [from,to]` e **ASSERTAR** contagem = `to−from+1` e min/max de
  height = from/to — falhando alto se divergir. Motivo: `bucketByDay` (`metashrew-export.ts:57`) só SOMA,
  não deduplica por height; se o snapshot vier com um bloco a mais (off-by-one), a sobreposição com o
  ft-d **dobraria silenciosamente** as métricas do dia da fronteira (dado corrompido sem erro — o pior
  modo de falha). Uma fonte `fetchRange` já devolve exatamente `[from,to]`; a fonte `file:` tem que ter a
  mesma semântica.
- Fontes HTTP seguem via `fetchRange` (o ft-d). A concatenação `recs.push(...part)` (`export-blockspace.ts:56-64`)
  já existente une tudo antes do `bucketByDay` → nada mais muda a jusante.
- Path relativo (`file:data/...`) resolve contra o **cwd = raiz do repo indexer** (o `census.yml` roda o
  `tsx` de dentro do clone sibling).

### C5 — Portabilidade do serve do metashrew no runner

O `run/index.sh` NÃO roda inalterado no CI (é WSL-específico): `index.sh:22` faz
`KEY=$(grep -m1 '^SUBFROST_KEY=' /mnt/c/.../.env.local ...)` **incondicionalmente** sob `set -euo
pipefail` (`index.sh:18`) → no runner o arquivo não existe, o grep sai ≠0 e o script **morre na hora**,
mesmo com `DAEMON_RPC_URL` setado; e `index.sh:25` (WASM) / `:26` (rockshrew) são paths `/mnt/c`/`$HOME`
hardcoded.

**Decisão:** o `census.yml` invoca o `rockshrew-mono` **direto com os args explícitos** (o passo 8 do
C3), pulando o `index.sh`. Mais simples e **não arrisca quebrar o fluxo WSL existente** do dono.
*Alternativa considerada:* parametrizar o `index.sh` (`WASM_PATH`/`ROCKSHREW_PATH` por env com os defaults
atuais; `KEY` só computado quando `DAEMON_RPC_URL` está vazio) — mais reúso, mais risco de regressão no
WSL. Ficamos com a invocação direta.

## Ordenação `census.yml` ↔ `daily.yml`

**Recomendado (Fable): `census.yml` em cron CEDO (04:45 UTC), SEM dispatch nenhum.** O `daily.yml`
(06:17 UTC) simplesmente pega o `blockspace-daily.json` que estiver commitado — fresco quando o census
foi bem, de ontem quando falhou/atrasou (a degradação que o spec já declara aceitável). Elimina a
corrida.

*Por que NÃO o dispatch:* census com build + catch-up dificilmente termina em 17 min (com cache frio,
impossível). Se o census disparasse o `daily.yml` ao terminar, o daily rodaria **2×/dia** (o cron 06:17
+ o dispatch), com duplo snapshot/publish e possível push-race no `history.csv` (dois dailies
concorrentes). Cron cedo + sem dispatch é 1 linha de cron e zero corrida.

*Se algum dia o dispatch voltar a ser desejado:* exige `permissions: actions: write` no census + um
`concurrency: { group: daily, cancel-in-progress: false }` no `daily.yml` (2 linhas, não fere o "fora de
escopo"), aceitando o daily duplo. Não é o caminho recomendado.

`concurrency` no próprio `census.yml` (group único) evita dois censuses sobrepostos disputando o cache.

## Riscos a derriscar (ordem do 1º passo do plano)

1. **Build do rockshrew-mono no runner Ubuntu** — o único desconhecido real do design (todo o resto é
   tecnologia provada). **PROVAR num workflow mínimo ANTES de investir no resto.** Nota: o
   `CXXFLAGS="-include cstdint"` foi pro g++ do **Ubuntu 26.04** da WSL (`index.sh:14`); o `ubuntu-latest`
   do Actions é **24.04**, onde pode nem ser necessário (e é inócuo se sobrar). Se travar, reavaliar (ex.:
   buildar no WSL e publicar o binário como release asset pro CI baixar).
2. **Tamanho do db-ft-d no cache** — medir com o rockshrew parado (comando em C2); confirmar que cabe no
   orçamento ~10 GB e cronometrar o custo de um re-index de fallback (951535→DHI) contra o teto de 6h.
3. **Gerar o snapshot histórico** (`dump-snapshot.ts`) uma vez no WSL, medir o `.json.gz` e confirmar que
   é commitável (esperado ~2–4 MB).

## Questões em aberto (confirmar no derisking / plano)

- **URL/owner do `alkanes-rs`** pro clone no CI (hoje é `/mnt/c/refs/alkanes-rs` local @ `888f4fe6` —
  confirmar o remote).
- **WASM no CI:** buildar (wasm32 + protoc) vs cachear vs commitar o `.wasm`. Recomendo cache; confirmar
  no derisking.
- **Qual endpoint** vira `CENSUS_RPC_URL` (um dos 5 hospedados, ou o gateway).
- **Limiar de lifecycle do db-ft-d** (quando cindir num `snapshot-2`/`ft-e`) — medir no derisking.

## Tratamento de erro

- **Census falha** (qualquer passo) → não commita `blockspace-daily.json`; o `daily.yml` roda com o último
  bom (degrada, não quebra — igual hoje).
- **RPC indisponível** → o serve do ft-d não alcança o tip; exportar com o que tem (`refresh-blockspace-fy.sh`
  já tem esse fallback).
- **Cache do db-ft-d perdido** → re-index de 951535, **resumível** entre runs pelo save `if: always()`
  (converge em N runs; nunca brica).

## Testes (TDD onde faz sentido)

- **`export-blockspace.ts` com `file:`** (função pura, `fetchImpl`/reader injetável): fixture de
  `BlockRecord[]` (com e sem `.gz`) + uma fonte HTTP mockada → dias corretos e **fronteira 951534/951535
  não parte dia**. Casos extras: arquivo com bloco a mais/a menos → **assert falha alto** (teste do
  filtro/assert de C4). Este é o teste-chave.
- **`dump-snapshot.ts`:** smoke leve (one-time) + o assert de contagem (71.535, min/max 880000/951534).
- **Workflow** (`census.yml`, cache, build do rockshrew): validado por **run real** no derisking, não por
  unit test.
- Todos os testes atuais do indexer/scanner seguem verdes.

## Critérios de sucesso

- Um run do `census.yml` **verde** produz `blockspace-daily.json` até o tip **sem tocar no PC**.
- O `/metrics` atualiza (`Last day` = ontem/hoje) via o pipeline `daily.yml` → sync do site.
- Derisking: build do rockshrew verde no runner; db-ft-d cabe no cache; snapshot commitável.

## Fora de escopo (YAGNI)

- Re-arquitetar o `daily.yml` ou o scanner (só adicionamos o `census.yml`; no máximo 2 linhas de
  `concurrency` se o dispatch voltar — não é o caminho recomendado).
- Tornar o snapshot histórico dinâmico — é imutável por design (a cisão `snapshot-2`/`ft-e` do lifecycle
  é manual/rara, não automática).
- Mudar o schema do `history.csv` / `blockspace-daily.json`.
- Backfill de genesis novo / re-indexar 880000–951534.

## Handoff pro `writing-plans` (esboço de fases)

- **Fase 0 (derisking, 1º task):** workflow mínimo que só builda o rockshrew-mono no runner e imprime a
  versão. Gate: verde antes de qualquer outra coisa.
- **Fase 1:** `dump-snapshot.ts` (com assert de contagem) + gerar/medir/commitar o snapshot histórico (WSL).
- **Fase 2:** `export-blockspace.ts` aceita `file:` com filtro + assert (TDD, teste da fronteira e dos
  casos de assert).
- **Fase 3:** `census.yml` completo (clones + caches restore/save-always + serve direto do rockshrew +
  kill+wait + export com DHI + commit com rebase + guard), com o secret `CENSUS_RPC_URL`.
- **Fase 4:** run real end-to-end + verificar `/metrics` avançando sozinho.
