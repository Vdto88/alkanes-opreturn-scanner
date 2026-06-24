# Design — Fase 2: fees/miners + top contratos não-DIESEL

**Data:** 2026-06-24 (revisado — substitui a versão anterior que cobria só fees)
**Status:** design aprovado pelo usuário → escrevendo plano da 2a

## Contexto

Depois da Fase 1 (penetration, Runes, Alkanes-sem-DIESEL) e Fase 1.5 (clareza, legenda clicável),
a Fase 2 adiciona dois temas que precisam de **dados novos** (logo, um re-scan):
1. **Fees / receita dos miners** em **USD+BTC** ao longo do tempo, e quanto vem de Alkanes/OP_RETURN.
2. **Top contratos não-DIESEL** — ranking all-time dos contratos Alkanes mais usados fora do mint de
   DIESEL (surfaça swaps do subfrost + "protocolo mais usado"), com nomes amigáveis.

## Decisões (brainstorming)

- **Fees:** USD **e** BTC (preço via CoinGecko: range no backfill + 1×/dia no daily). Re-backfill do
  período inteiro (cache só guarda agregado, não fee por tx).
- **0,2% não-DIESEL:** **por contrato-alvo** (top N all-time, com rótulos amigáveis), **não** por
  tipo de ação. Motivo: opcode é específico do contrato (não há "opcode = swap" universal); agregar
  por alvo surfaça os pools/AMM do subfrost sozinhos, sem manter lista frágil.
- **Split:** **2a (fees)** primeiro, **2b (contratos)** depois. **Uma única varredura** captura os
  dados dos dois (fee + alvo), então a captura no scanner e o re-scan ficam na 2a; a 2b é só relatório.
- Subsídio do bloco = **3,125 BTC** (constante: blocos 930000–955153 ficam entre os halvings de
  840000 e 1050000).

## Captura no scanner (compartilhada — entra na 2a, habilita 1 re-scan só)

- **`src/esplora.ts`**: `EsploraTx` ganha `fee?: number` (sats) e `is_coinbase?: boolean`. O esplora já
  devolve ambos na mesma resposta `/block/<h>/txs/<i>` (verificado) — custo zero de rede.
- **`src/classify.ts`**: `TxClass` ganha `nonDieselTarget?: string` — o alvo `"block:tx"` do cellpack
  quando a tx é Alkanes e **não** é mint de DIESEL e tem cellpack (primeiro protostone Alkanes com
  cellpack). Usa o `p.cellpack.target.block`/`.tx` que o decoder já expõe.
- **`src/metrics.ts`**: `ScanAggregate` ganha `feeTotalSats`, `feeAlkanesSats`, `feeOpReturnSats`.
- **`src/scan.ts`**: `scanBlock` soma fees por tx (coinbase = 0; se `isAlkanes` → `feeAlkanesSats`; se
  `hasOpReturn` → `feeOpReturnSats`) e monta um mapa por bloco `nonDieselTargets: Record<string,number>`
  (conta cada `nonDieselTarget`). `BlockResult` (cache) ganha esses campos — assim é reconstruível.

## Dados duráveis

- **`history.csv`** ganha colunas: `feeTotalSats`, `feeAlkanesSats`, `feeOpReturnSats`, `btcUsd`.
  (Parser já lê por nome com default 0 → CSV antigo segue válido.)
- **`contracts-daily.json`** (novo, durável, committed): array `{date, targets:{"block:tx":count}}`,
  **upsert por data** (igual ao history.csv). Cardinalidade variável não cabe em coluna fixa; este
  arquivo é o registro durável dos alvos não-DIESEL por dia. Backfill reconstrói do cache; daily faz
  upsert do dia. Módulo novo `tools/contracts.ts` (read/write/upsert + `topTargets(rows, n)`), com testes.
- **Preço BTC/USD:** módulo novo `tools/price.ts` — `fetchRange(from,to)` (CoinGecko
  `/coins/bitcoin/market_chart/range`, 1 chamada no backfill) e `fetchDay(date)` (daily). `fetchImpl`
  injetável → testável sem rede.

## Pipelines

- **`tools/seed-history.ts`** (backfill rebuild do cache): além das linhas de history (com fees), emite
  `contracts-daily.json` (datando os `nonDieselTargets` por dia) e preenche `btcUsd` por dia via
  `price.fetchRange`.
- **`tools/snapshot.ts`** (daily): além da linha do dia (com fees), faz upsert do dia em
  `contracts-daily.json` e preenche `btcUsd` via `price.fetchDay`.

## Relatório (`tools/build-report.ts`)

### 2a — Fees / receita dos miners
- **Métricas derivadas** (em `history.ts`/`metrics.ts`, com testes):
  - `feeDayBtc = feeTotalSats/blocksScanned × 144 / 1e8` (extrapola a amostra pro dia cheio).
  - `minerRevenueUsdDay = (feeDayBtc + 144 × 3.125) × btcUsd` (fees + subsídio, em USD).
  - `feeAlkanesShare = feeAlkanesSats / feeTotalSats`; `feeOpReturnShare = feeOpReturnSats / feeTotalSats`.
- **Gráfico** "Miner fee revenue (USD/day)" ao longo do tempo (linha/área); tooltip mostra BTC.
- **Card/nota** "% da receita de fees que é Alkanes/OP_RETURN" (all-time/30d).
- Nota de metodologia (extrapolação + subsídio), no estilo das notas atuais.

### 2b — Top contratos não-DIESEL
- Tabela/ranking all-time (de `contracts-daily.json` via `topTargets`) dos contratos não-DIESEL mais
  usados: `block:tx` + nome amigável + contagem.
- **Mapa de rótulos** estático em `build-report.ts` (ou `tools/labels.json`), semeado do que sabemos:
  `2:0`→"DIESEL", `2:77087`→"subfrost DIESEL/frBTC pool"; alvos sem rótulo aparecem como `block:tx`.
  Ampliável depois sem afetar a correção.
- Top N = 12 (ajustável).

## Re-scan

Após a captura no scanner (2a) mergeada: rodar `backfill.yml` 1× (blocos 930000→955153) — popula fee +
alvos no cache → `seed-history` reconstrói history.csv (com fees) + `contracts-daily.json`, preço pelo
`price.ts` → publica. ~5h, automático.

## Tratamento de erro

- Preço indisponível (CoinGecko fora/limit) → `btcUsd=0` no dia → gráfico USD pula o dia; BTC segue.
  Nunca derruba daily/backfill.
- `fee` ausente / coinbase → 0. `nonDieselTarget` ausente → tx não entra no mapa.
- Scanner já é resiliente (commit 7e6c009: retry/backoff, pula bloco falho).

## Testes (TDD nas funções puras)

- `classify`: `nonDieselTarget` correto (Alkanes não-DIESEL com cellpack → "block:tx"; DIESEL → undefined).
- `scan`/`metrics`: soma de fees por bucket (coinbase 0); mapa `nonDieselTargets` agregado.
- `history`: colunas novas (parse/escrita/retrocompat); métricas de fee (extrapolação + subsídio + share).
- `contracts` (`tools/contracts.ts`): upsert por data, `topTargets` ordena e soma all-time.
- `price` (`tools/price.ts`): parse da resposta CoinGecko (range e dia) com `fetchImpl` mockado.
- `report`/smoke: build não quebra com os novos campos/arquivo.
- Todos os 31 testes atuais seguem verdes.

## Plano de entrega (split)

- **2a** = captura no scanner (fee + alvo) + `history.csv` fees + `contracts-daily.json` plumbing +
  `price.ts` + pipelines + **re-scan** + **relatório de fees**. (A captura de alvos entra aqui pra o
  re-scan ser único, mesmo o ranking sendo renderizado só na 2b.)
- **2b** = **relatório de top contratos** (lê `contracts-daily.json`, sem novo scan) + mapa de rótulos.

## Fora de escopo (YAGNI)

- Split por tipo de ação (mint/deploy/transfer/swap) — não escolhido (swap não isola limpo).
- Preço intradiário / feerate em sats/vB.
- Buscar nomes de token on-chain — rótulos são um mapa estático ampliável.
