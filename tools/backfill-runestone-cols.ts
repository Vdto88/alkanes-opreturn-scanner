import { readHistory, writeHistory } from './history';
import { readFileSync } from 'node:fs';

// One-off: preenche as 2 colunas txAlkRunestone/txPureRunes no history.csv a partir do
// blockspace-daily.json (censo). Contagem REAL do dia (raw — o censo processa o dia inteiro,
// ~130-160 blocos; NÃO extrapola). Dia sem censo → coluna vazia (padrão weight/UG).
//   txAlkRunestone = tx Runestone que são Alkanes (protocol_tag=1) = blockspace.txAlkanes
//   txPureRunes    = tx Runestone que NÃO são Alkanes (Runes puras) = blockspace.txRunes
// Uso: npx tsx tools/backfill-runestone-cols.ts [historyPath] [blockspacePath]

const historyPath = process.argv[2] ?? 'history.csv';
const bsPath = process.argv[3] ?? 'blockspace-daily.json';

interface BsDay { date: string; txAlkanes?: number; txRunes?: number }
const bs: BsDay[] = JSON.parse(readFileSync(bsPath, 'utf8'));
const bm = new Map(bs.map((d) => [d.date, d]));

const rows = readHistory(historyPath);
let filled = 0;
for (const r of rows) {
  const b = bm.get(r.date);
  if (b && b.txAlkanes !== undefined && b.txRunes !== undefined) {
    r.txAlkRunestone = b.txAlkanes;
    r.txPureRunes = b.txRunes;
    filled++;
  }
}
writeHistory(historyPath, rows);
console.log(`${historyPath}: ${filled}/${rows.length} dias preenchidos com txAlkRunestone/txPureRunes (raw do censo)`);
