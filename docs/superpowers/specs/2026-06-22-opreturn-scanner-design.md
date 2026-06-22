# Design — `opreturn-scanner` (v2 do op decode)

> Data: 2026-06-22 · Workspace: `C:\OpDecoder` · Status: **aprovado, pré-plano**
> Kickoff de origem: `C:\OpDecoder\kickoff-opreturn-scanner.md`
> Base de conhecimento: `C:\Alkanes Learn\alkanes-knowledge.md`

## Problema / objetivo

Produzir, de forma **independente e defensável**, os 3 números que o gabe pediu (para
headline/tweet/artigo), reusando o **decoder v1** (`C:\OpDecoder\opreturn-decoder`, 41/41) como
classificador "é Alkanes?":

1. **% das tx de BTC que têm OP_RETURN**
2. **% dos OP_RETURN que são Alkanes**
3. **% das tx de BTC que são, portanto, Alkanes** (= 1 × 2)

Metas de sanidade (ordem de grandeza, divergência documentável): **~91% do OP_RETURN = Alkanes
por bytes** (Blockspace #29 / @CunyRenaud, 60 dias) e **~43.6% das tx BTC = Alkanes** (gabe / Dune
misha). O 91% é **share de DADOS (bytes)**, não contagem — por isso medimos as duas coisas.

### Escopo desta sessão (decidido)

**Slice vertical primeiro.** Construir o scanner end-to-end e provar numa **janela pequena (~50
blocos recentes)**: as 3 métricas por **contagem E bytes** + cobertura honesta, e validar a
classificação Alkanes contra o **espo** numa amostra de txids. A janela de ~2 meses e a
**amostragem** ficam como **flags** (`--from/--to`, `--sample`), para rodada à parte.

**Fora (depois):** UI web, banco, classificação fina de todos os metaprotocolos (Runes vs
Ordinals vs BRC20), e o indexer-wasm exato no metashrew (Caminho B). Começamos com a dicotomia
**Alkanes × resto**, que é o que o número pede.

## Abordagem (Caminho A — reuso real do v1)

Novo projeto `C:\OpDecoder\opreturn-scanner`, **TypeScript + `tsx`** (igual o v1), repo git
próprio. Importa o decode do v1 por **path relativo** — sem reimplementar protostone/cellpack.

- **Reuso = `decodeOpReturn(opReturnHex, vout)`** de `../opreturn-decoder/src/decode`. O caminho
  de decode do v1 **não tem dependências externas** (só TS local: `script`, `tx`, `runestone`,
  `protostone`, `cellpack`, `burn`, `hex`, `leb128`), então o scanner roda com o **seu próprio**
  `node_modules` (tsx/vitest/typescript/@types/node) — não precisa do node_modules do v1.
- **Fetch leve (sem raw hex):** o endpoint esplora `GET /block/<hash>/txs/<i>` devolve cada tx já
  decodificada com o `scriptpubkey` (hex) de cada vout, em páginas de 25. Isso basta para os três
  sinais e para os bytes — não baixamos o raw inteiro de cada tx.

### Fonte de dados

- **Provedor default: subfrost** (canônico, sem rate limit) via
  `https://mainnet.subfrost.io/v4/<key>`. **Correção (descoberta na execução, 2026-06-22):** o
  gateway subfrost é **JSON-RPC POST**, não REST — a superfície esplora vira método `esplora_` +
  path com `/`→`:` (`esplora_blocks:tip:height`, `esplora_block:<hash>:txs:<start>`, …), `params:[]`.
  Gotcha `-32603` transiente (vem em `error.code` no corpo) → **retry resolve**.
- Alternativos via `--source`: `mempool` (`https://mempool.space/api`), `alkanode`.
- **Key:** passada por `--subfrost-key` ou env `SUBFROST_KEY`; persistida só em `.env.local`
  (**gitignored**). **Nunca** commitar a key (cf. episódio da chave Stripe no changelog).

## Componentes (unidades pequenas, testáveis isoladas)

| Módulo | O que faz | Depende de |
|---|---|---|
| `esplora.ts` | `tipHeight()`, `blockHash(h)`, `blockTxs(hash)` (pagina /25 até esgotar). Base URL por `--source`; retry p/ `-32603`/HTTP transiente. | `fetch` |
| `classify.ts` | `classifyTx(vouts) → TxClass`. Reusa `decodeOpReturn` do v1. Pura, offline, sem rede. | v1 `decodeOpReturn` |
| `cache.ts` | `read(height)`, `write(height, BlockResult)` em `./cache/<height>.json`. Resumível. | fs |
| `scan.ts` | Orquestra um range/amostra: cache-or-fetch → classifica todas as tx → agrega contagens e bytes → `ScanResult`. | esplora, classify, cache |
| `metrics.ts` | Deriva as 3 métricas (contagem e bytes) + cobertura a partir do agregado. Pura. | — |
| `report.ts` | Formata: tabela de números + 1 parágrafo pronto p/ colar; imprime cobertura e ressalvas. | metrics |
| `cli.ts` | Flags, monta opções, roda `scan` → `report`. | tudo acima |

### Tipos centrais

```ts
interface TxClass {
  hasOpReturn: boolean;   // algum vout começa com 6a
  opReturnBytes: number;  // soma len(scriptPubKey)/2 dos vouts OP_RETURN da tx
  hasRunestone: boolean;  // algum vout começa com 6a5d
  isAlkanes: boolean;     // decodeOpReturn(...).protostones.some(p => p.isAlkanes)
  alkanesBytes: number;   // bytes do(s) output(s) OP_RETURN runestone que são Alkanes
}

interface ScanAggregate {
  totalTx: number;
  txWithOpReturn: number;
  txAlkanes: number;
  opReturnBytesTotal: number;
  alkanesBytesTotal: number;
}

interface Coverage {
  fromHeight: number; toHeight: number;
  blocksScanned: number; sampled: boolean; sampleEvery?: number;
  totalTx: number; txWithOpReturn: number; txAlkanes: number;
}
```

## Fluxo de classificação (por tx)

Para cada vout, olhar o prefixo do `scriptpubkey`:
- começa com `6a` → **OP_RETURN**: `hasOpReturn=true`, soma `len/2` em `opReturnBytes`.
- começa com `6a5d` → **runestone**: `hasRunestone=true`; chama `decodeOpReturn(scriptHex, vout)`
  **em try/catch** (runestones malformados existem on-chain). Se `protostones.some(isAlkanes)` →
  `isAlkanes=true` e soma os bytes desse output em `alkanesBytes`.

`isAlkanes` não depende do layout de vouts (≠ detecção de burn), então o `vout` passado é só o
índice informativo; a classificação é robusta mesmo sem o conjunto completo de outputs.

## As 3 métricas (contagem **e** bytes)

| # | Métrica | Por contagem | Por bytes (reproduz o 91%) |
|---|---|---|---|
| 1 | tx com OP_RETURN | `txWithOpReturn / totalTx` | — |
| 2 | OP_RETURN que são Alkanes | `txAlkanes / txWithOpReturn` | `alkanesBytesTotal / opReturnBytesTotal` |
| 3 | tx BTC que são Alkanes | `txAlkanes / totalTx` (= 1×2) | — |

### Decisões de metodologia (explícitas; cada uma é um "botão" se o número não bater)

1. **Definição de "bytes" = tamanho do scriptPubKey** do output OP_RETURN (`len(hex)/2`). É a
   medida simples e padrão de explorer. Alternativa: só o *payload* empurrado após `OP_RETURN`
   (descontando opcode + pushdata). **Primeiro botão a girar** se o share por bytes não chegar
   perto do 91% do Cuny.
2. **Denominador da métrica 2 = todos os OP_RETURN** (`6a`), não só runestones (`6a5d`). É o
   enquadramento "do uso total de OP_RETURN, quanto é Alkanes" — igual o Cuny.
3. **Coinbase incluída.** O witness-commitment é um OP_RETURN real (`6a24aa21a9ed…`) → conta em
   "tem OP_RETURN" mas não é Alkanes (+1 por bloco; desprezível em 50 blocos). Reportado com
   ressalva; flag futura `--exclude-coinbase` se quisermos a medida sem ele.

## Cache & performance

- `./cache/<height>.json` guarda o **`BlockResult`** distilado (lista de `TxClass` + agregado do
  bloco), permitindo **retomar** e **re-agregar** sem refazer rede.
- `--sample K` = varrer 1 bloco a cada K e **reportar como amostra** (com intervalo). Para o slice
  vertical (50 blocos) roda sem amostragem.
- **Sempre reportar a janela real** (altura inicial→final, nº blocos, nº tx, nº OP_RETURN, nº
  Alkanes), com flag `sampled`.

## CLI

```
tsx src/cli.ts [opções]
  --blocks N            últimos N blocos a partir do tip (default p/ a demo: 50)
  --from H --to H       range explícito de alturas (sobrepõe --blocks)
  --source subfrost|mempool|alkanode   (default subfrost)
  --subfrost-key KEY    (ou env SUBFROST_KEY; ou .env.local)
  --sample K            amostrar 1 a cada K blocos
  --no-cache            ignora o cache em disco
```

## Erros & robustez

- `decodeOpReturn` lança em runestone malformado → **try/catch**, conta como "tem OP_RETURN /
  runestone" mas **não** Alkanes; loga contagem de falhas de decode na cobertura.
- Fetch: retry (cobre `-32603` e HTTP transiente); se um bloco falhar de vez, **abortar com
  mensagem clara** (não envenenar o agregado com bloco parcial). Cache só grava bloco completo.
- Sem rede pro registry: o scanner não depende de `pkg.alkanes.build`; só `fetch` à esplora.

## Testes (vitest, determinísticos)

- `classify.test.ts` — fixtures de `scriptpubkey`: OP_RETURN não-runestone (`6a…`), runestone
  Alkanes (reusa uma fixture conhecida do v1, ex.: a tx de burn `b9f28df4…`), runestone não-Alkanes,
  sem OP_RETURN, coinbase witness-commitment. Verifica flags e contagem de bytes.
- `metrics.test.ts` — agregados sintéticos → as 3 métricas (contagem e bytes) corretas; divisão por
  zero (sem OP_RETURN) tratada.
- `esplora.test.ts` — `fetchImpl` mockado: paginação /25, montagem de URL por `--source`, retry no
  `-32603`.
- `cache.test.ts` — round-trip read/write em tmp dir.
- Fetch real fica fora dos testes (não-determinístico); validação contra espo é manual no aceite.

## Critérios de aceite (desta sessão)

1. `--blocks 50` via subfrost imprime as 3 métricas **por contagem e por bytes** + cobertura.
2. A classificação "é Alkanes" usa o **decoder v1** (reuso real) e bate, numa amostra de txids
   conhecidos, com o **espo** (`espo.sh/tx/<txid>`).
3. Roda no Windows + Git Bash via `tsx`; cacheável e retomável.
4. Saída final tem um bloco "pronto pra colar" (1 parágrafo + tabela).
5. (janela maior, à parte) share por **bytes** na vizinhança do **91%**; **% tx = Alkanes** perto
   de **~43.6%** — ordem de grandeza, divergência documentada.

## Convenções

- Aprendizado novo (bug/macete/decisão) → `## Aprendizados (changelog)` do
  `C:\Alkanes Learn\alkanes-knowledge.md`, com data.
- Windows + Git Bash; `git -C <path>`; sem heredoc no PowerShell; nunca pipar build por
  `| tail`/`| head`.
