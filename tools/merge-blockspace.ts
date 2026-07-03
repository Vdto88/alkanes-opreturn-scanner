import { readFileSync } from 'node:fs';
import { readHistory, writeHistory } from './history';

// Copia as 4 colunas do indexer (weight/UG, censo) do blockspace-daily.json pras linhas do
// history.csv, casando por data. As mesmas 4 métricas que o dashboard já mostra nos 2 gráficos
// do arquivo lateral, agora TAMBÉM no CSV pro consumidor externo (subfrost.io) renderizar.
// Datas sem entrada no lateral ficam VAZIAS (não 0). Idempotente.
// Uso: tsx tools/merge-blockspace.ts [historyPath] [blockspacePath] [--dry]

interface BsDay { date: string; weightTotal: number; weightAlkanes: number; ugMints: number; dieselUg: number; }

const argv = process.argv.slice(2);
const positional = argv.filter((a) => !a.startsWith('--'));
const historyPath = positional[0] ?? 'history.csv';
const bsPath = positional[1] ?? 'blockspace-daily.json';
const dry = argv.includes('--dry');

const bs: BsDay[] = JSON.parse(readFileSync(bsPath, 'utf8'));
const byDate = new Map(bs.map((b) => [b.date, b]));
const rows = readHistory(historyPath);

let filled = 0;
for (const r of rows) {
  const b = byDate.get(r.date);
  if (!b) continue; // sem dado do indexer nessa data → deixa vazio (não 0)
  r.weightTotal = b.weightTotal;
  r.weightAlkanes = b.weightAlkanes;
  r.ugMints = b.ugMints;
  r.dieselUg = b.dieselUg;
  filled++;
}

const covered = rows.filter((r) => r.weightTotal !== undefined).length;
const bsDates = bs.map((b) => b.date).sort();
console.log(`merge-blockspace: ${filled}/${rows.length} linhas do history casadas (lateral: ${bs.length} dias, ${bsDates[0]}..${bsDates[bsDates.length - 1]}); ${rows.length - covered} linha(s) sem weight (vazias)${dry ? ' (dry-run, nada gravado)' : ''}`);
if (!dry) writeHistory(historyPath, rows);
