import { readHistory, writeHistory } from './history';
import { readFileSync } from 'node:fs';

// One-off: preenche txAlkRunestone/txPureRunes no history.csv a partir do blockspace-daily.json (censo).
// Valor = CONTAGEM ESTIMADA DO DIA INTEIRO (×144 / nº de blocos do CENSO daquele dia), NÃO raw.
// Motivo: as contagens vêm do censo, que indexou um nº de blocos (b.blocksScanned) DIFERENTE do
// blocksScanned (amostra) da linha do history — então o consumidor NÃO pode extrapolar com o
// blocksScanned da linha (sairia 5-6× inflado, dias parciais até ×28). Pré-extrapolamos aqui pro dia
// inteiro, batendo com txAlkAbsDaily/txRunesAbsDaily do build-report.ts (dashboard).
//   txAlkRunestone = tx Runestone que são Alkanes (protocol_tag=1); txPureRunes = Runestone não-Alkanes.
// <1 ou sem dado → undefined = célula VAZIA (o gráfico de contagem/dia é log-scale; 0 quebraria o log).
// Uso: npx tsx tools/backfill-runestone-cols.ts [historyPath] [blockspacePath]

const historyPath = process.argv[2] ?? 'history.csv';
const bsPath = process.argv[3] ?? 'blockspace-daily.json';

interface BsDay { date: string; txAlkanes?: number; txRunes?: number; blocksScanned?: number }
const bs: BsDay[] = JSON.parse(readFileSync(bsPath, 'utf8'));
const bm = new Map(bs.map((d) => [d.date, d]));

// contagem estimada do dia inteiro; <1 ou sem dado → undefined (célula vazia)
const perDay = (count: number | undefined, blk: number | undefined): number | undefined => {
  if (count === undefined || !blk) return undefined;
  const v = Math.round((count / blk) * 144);
  return v >= 1 ? v : undefined;
};

const rows = readHistory(historyPath);
let filled = 0;
for (const r of rows) {
  const b = bm.get(r.date);
  if (!b) continue;
  r.txAlkRunestone = perDay(b.txAlkanes, b.blocksScanned);
  r.txPureRunes = perDay(b.txRunes, b.blocksScanned);
  if (r.txAlkRunestone !== undefined || r.txPureRunes !== undefined) filled++;
}
writeHistory(historyPath, rows);
console.log(`${historyPath}: ${filled}/${rows.length} dias preenchidos com txAlkRunestone/txPureRunes (estimativa ×144 do dia inteiro)`);
