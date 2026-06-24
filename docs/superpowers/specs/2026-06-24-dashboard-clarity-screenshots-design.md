# Design — Dashboard clareza & screenshots (Fase 1.5)

**Data:** 2026-06-24
**Status:** design aprovado pelo usuário → escrevendo plano

## Contexto

Depois da Fase 1 (OP_RETURN penetration, linha de Runes, Alkanes-sem-DIESEL), o usuário pediu
melhorias de **clareza** e de **screenshot** no dashboard (`build-report.ts` → `report.html` → Pages).
Tudo aqui é **só no relatório** — nenhuma coluna nova, nenhum re-scan.

## Decisões (brainstorming)

- **Toggle:** virar **legenda clicável** (a própria legenda HTML do gráfico diário liga/desliga a linha;
  item apagado/riscado quando off). Remove a fileira de checkboxes → print limpo, estilo consistente.
- **Nota de reconciliação:** **genérica** (usuário não sabe a base exata do "91%" que circula).
- **Sem re-scan.** Fees + "0,2% por tipo" ficam pra Fase 2 (re-scan único), fora deste escopo.

## Mudanças (todas em `tools/build-report.ts`)

### 1. Rótulos claros nos cards
Hoje o card mostra `75.3%` e `97.4% of bytes` — não diz a base de cada número. Reestruturar o
helper `card()` para deixar explícito:
- valor grande: `75.3%`
- sub-rótulo do valor: `Alkanes — of all BTC tx`
- linha de bytes: `97.4% of OP_RETURN bytes` (era "of bytes")

O card de penetration: valor `52.7%`, sub-rótulo `of all BTC tx (carry OP_RETURN)`, `b` = `63.1% last 30 days`.

### 2. Glossário "How it's calculated"
Expandir a seção existente com uma linha por métrica, em linguagem simples:
- **OP_RETURN penetration** — % de todas as tx do BTC que têm um output OP_RETURN.
- **Alkanes (tx)** — % de todas as tx do BTC que são Alkanes.
- **Alkanes (bytes)** — % dos bytes de OP_RETURN que são Alkanes.
- **Runes** — % dos bytes de OP_RETURN que são Runes (Runestone que não é Alkanes).
- **Alkanes excl. DIESEL** — % das tx que são Alkanes mas não mint de DIESEL (uso "de app").
- **DIESEL** — mint do alkane genesis (cellpack 2:0 op 77); hoje ~99,8% da atividade Alkanes.

### 3. Nota de reconciliação (genérica)
Linha discreta perto dos cards (reaproveitar estilo `.note`/`.sub`):
> "Você pode ver números diferentes por aí — eles variam conforme a janela de tempo e se medem
> transações vs bytes vs outputs (e se incluem a coinbase)."

### 4. Legenda clicável (substitui os checkboxes)
- Remover a `<div class="legend">` de checkboxes (`tgPen`/`tgRunes`/`tgAlkEx`) e o `forEach` de bind.
- Tornar cada `<span>` da legenda HTML do gráfico diário clicável: adicionar `data-ds="<idx>"` ao span
  e `cursor:pointer`; um listener percorre `[data-ds]`, no clique faz
  `gChart.setDatasetVisibility(idx, !visível); gChart.update();` e alterna uma classe `off`
  (`opacity:.4; text-decoration:line-through`) no span.
- Datasets do `#g` (ordem atual): 0 bytes, 1 tx, 2 penetration, 3 Runes, 4 Alkanes-excl-DIESEL. Todos
  começam visíveis.
- CSS novo mínimo: `.legend span[data-ds]{cursor:pointer} .legend span.off{opacity:.4;text-decoration:line-through}`.

## Arquitetura

Único arquivo: `tools/build-report.ts` (template HTML + `<style>` + script inline). Sem mudanças em
`history.ts`, `scan.ts`, `metrics.ts`, nem em colunas do CSV. `report.html` é regenerado pelo daily.

## Tratamento de erro

- Legenda clicável é progressive enhancement: se o JS falhar, as linhas só ficam todas visíveis
  (estado atual de hoje) — nada quebra.

## Testes

`build-report.ts` é script gerador, sem suíte própria (só `tools/history.test.ts` existe em `tools/`).
Como esta fatia **não adiciona funções puras** (só template + DOM JS), a verificação é:
- rodar `tsx tools/build-report.ts` (sem erro);
- `grep` confirmando: rótulos novos nos cards, glossário, nota, `data-ds` nos spans, ausência de
  `tgRunes`/`setDatasetVisibility` no bloco de checkbox antigo;
- extrair o `<script>` inline e `node --check` (sintaxe JS válida);
- render visual: 5 linhas, clicar numa legenda esconde/mostra a linha.
- Os **31 testes** vitest existentes continuam passando (nada que eles cobrem muda).

## Fora de escopo (Fase 2)

- Fees / receita dos miners (USD+BTC).
- Abrir o 0,2% não-DIESEL em transfers/swaps/deploys (precisa decodificar opcode + re-scan).
Ambos no mesmo re-scan futuro. Ver `2026-06-24-dashboard-metrics-expansion-design.md`.
