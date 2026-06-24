# Design — Expansão de métricas do dashboard (OP_RETURN penetration, Runes toggle, fees/miners)

**Data:** 2026-06-24
**Status:** aprovado (design); aguardando revisão do spec → plano de implementação

## Contexto

O dashboard (`build-report.ts` → `report.html` → Pages) hoje mostra: share de Alkanes em tx e bytes
(cards ontem/7d/30d/all), linha diária de Alkanes (bytes+tx), linha de DIESEL, e a rosca
Alkanes/Runes/Other (all-time). Dados vêm do `history.csv` (1 linha/dia, ~178 dias Dez 29→agora).

O usuário quer **3 acréscimos** (escolhidos de um menu de ideias):
1. **% das tx de BTC que carregam OP_RETURN** — o número-base do kickoff, hoje ausente.
2. **Linha diária de Runes (liga/desliga)** + **linha "Alkanes sem DIESEL"** — foco é Alkanes, mas o
   dado de Runes é interessante de poder ligar.
3. **Fees / receita dos miners** — quanto os miners ganham de fee, **como cresceu ao longo do tempo**,
   e **quanto dessa receita vem de Alkanes/OP_RETURN**. Em **USD (+ BTC)**.

## Decisões já tomadas (brainstorming)

- **Unidade de fee:** USD **e** BTC. USD precisa de histórico diário de preço do BTC → CoinGecko
  (range único no backfill + 1×/dia no daily).
- **Histórico de fees:** **re-backfillar** o período inteiro capturando fees agora (≈5h de scan,
  automático), porque a curva de crescimento é justamente a história. (Alternativa "fees só daqui pra
  frente" foi rejeitada: gráfico começaria vazio.)
- **Toggle de Runes:** começa **visível**, com checkbox pra esconder.

## Faseamento

A entrega é dividida porque **2 das 3 features não precisam de scan novo** (o dado já está no
`history.csv`); só fees precisa de colunas novas + re-backfill.

### Fase 1 — ganhos imediatos (só relatório, sem re-scan)

Tudo derivado de colunas que já existem (`txWithOpReturn`, `totalTx`, `runestoneBytes`, `txAlkanes`,
`dieselMints`). Publica no próximo daily (ou disparo manual do build).

**1a. OP_RETURN penetration** — `% = txWithOpReturn / totalTx`.
- `history.ts` já tem `opReturnShare(s)`. Surgir no relatório como **um card novo** ("OP_RETURN tx —
  % de todas as tx do BTC", com all/7d/30d) e como **linha diária** no gráfico de share.
- Contextualiza o painel e conecta com o ~43,6% do Dune (thread aberta de reconciliação).

**1b. Linhas extras no gráfico diário** (`#g`):
- **Runes (bytes/dia)** = `runesBytesShare(row)` — já existe em `history.ts`.
- **Alkanes sem DIESEL (tx/dia)** = `(txAlkanes − dieselMints) / totalTx` — helper novo
  `alkExDieselShareCount(s)` em `history.ts` (+ teste).
- **Toggle:** checkboxes acima do gráfico (`Mostrar Runes`, `Mostrar Alkanes s/ DIESEL`) que chamam
  `chart.setDatasetVisibility(i, on); chart.update()`. Combina com as legendas HTML atuais
  (`legend:{display:false}` no Chart.js). Runes default **on**.

### Fase 2 — fees & miners (colunas novas + re-backfill + preço)

**2a. Captura de fee (custo zero de rede — mesma resposta do esplora):**
- `EsploraTx` ganha `fee?: number` e `is_coinbase?: boolean` (`esplora.ts`). O fetch já recebe esses
  campos; hoje são descartados.
- `ScanAggregate` (`metrics.ts`) ganha `feeTotalSats`, `feeAlkanesSats`, `feeOpReturnSats`.
- `scanBlock` (`scan.ts`): por tx, soma `tx.fee` em `feeTotalSats` (coinbase tem fee 0/ausente → 0);
  se `isAlkanes` soma em `feeAlkanesSats`; se `hasOpReturn` soma em `feeOpReturnSats`. (Classificação
  já existe; só adicionar a atribuição de fee.)

**2b. Preço do BTC (USD):**
- Novo `tools/price.ts`: busca preço diário (USD) do BTC. Duas entradas: range (backfill, 1 chamada
  CoinGecko `/coins/bitcoin/market_chart/range`) e dia único (daily, `/simple/price` ou history).
  `fetchImpl` injetável → testável sem rede.
- `HistoryRow` ganha `btcUsd` (preço de fechamento/representativo do dia). `seed-history.ts`/`snapshot.ts`
  preenchem por data (join preço×dia). Coluna ausente em CSV antigo → 0 (padrão do parser por nome).

**2c. Colunas novas em `history.csv`:** `feeTotalSats`, `feeAlkanesSats`, `feeOpReturnSats`, `btcUsd`.
(O parser já lê por nome e default 0, então CSVs antigos continuam válidos.)

**2d. Métricas derivadas (`history.ts`/`metrics.ts`, com testes):**
- **Fees do dia (extrapolado):** `feeDayBtc = feeTotalSats/blocksScanned × 144 / 1e8`.
- **Receita total do miner/dia:** `feeDayBtc + 144 × 3.125` (subsídio constante: todos os blocos
  930000–955153 estão entre os halvings de 840000 e 1050000). Em USD: `× btcUsd`.
- **Share das fees:** `feeAlkanesSats/feeTotalSats` e `feeOpReturnSats/feeTotalSats`.

**2e. UI (`build-report.ts`):**
- **Gráfico "Receita de fees dos miners"** (USD/dia) ao longo do tempo; tooltip mostra BTC também.
  Opcional: empilhar/destacar a fatia "vinda de Alkanes/OP_RETURN".
- **Card/nota "% da receita de fees que é Alkanes/OP_RETURN"** (all/30d).
- Nota de metodologia explícita (extrapolação da amostra + subsídio), no estilo das notas atuais.

**2f. Re-backfill:** o `cache/` guarda só agregado (`BlockResult`), não tx cru → fees **não estão no
cache**, exige re-scan. Rodar `backfill.yml` de novo (mesmos blocos 930000→955153) depois do código de
fee mergeado; preço backfillado pelo `price.ts`. ~5h, automático, publica sozinho ao terminar.

## Arquivos afetados

| Arquivo | Fase | Mudança |
|---|---|---|
| `tools/build-report.ts` | 1,2 | cards/linhas/gráficos novos + toggles + nota |
| `tools/history.ts` | 1,2 | helper `alkExDieselShareCount`; colunas fee/btcUsd; métricas de fee |
| `src/esplora.ts` | 2 | `EsploraTx.fee`, `is_coinbase` |
| `src/metrics.ts` | 2 | `feeTotalSats`/`feeAlkanesSats`/`feeOpReturnSats` no agregado |
| `src/scan.ts` | 2 | atribuição de fee por tx |
| `tools/seed-history.ts`, `tools/snapshot.ts` | 2 | propagar fee + `btcUsd` por dia |
| `tools/price.ts` (novo) | 2 | fetch de preço BTC/USD (range + dia), injetável |

## Tratamento de erro

- **Preço indisponível** (CoinGecko fora/rate-limit): degrada — `btcUsd=0`/dia → gráfico USD pula o dia,
  BTC continua. Nunca derruba o daily/backfill.
- **`fee` ausente** (fonte sem o campo / coinbase): trata como 0.
- Scan já é resiliente (commit 7e6c009: retry+backoff, pula bloco falho).

## Testes (TDD em tudo)

- `classify`/`scan`: atribuição de fee (Alkanes vs OP_RETURN vs total; coinbase = 0).
- `metrics`: agregação dos novos campos de fee.
- `history`: parse/escrita das colunas novas; retrocompat (CSV sem as colunas → 0);
  `alkExDieselShareCount`; métricas de fee (extrapolação + subsídio + share).
- `price`: parse da resposta CoinGecko com `fetchImpl` mockado (range e dia).
- `report`/smoke: build não quebra com os novos campos.

## Fora de escopo (YAGNI)

- Famílias de OP_RETURN (Ordinals/BRC-20/Stamps) — opção não escolhida agora.
- Listar quais Alkanes além do DIESEL — não escolhida agora.
- Preço intradiário/feerate em sats/vB — pode entrar depois se útil.
