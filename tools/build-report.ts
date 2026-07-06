import { writeFileSync, readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import {
  readHistory, rollup, alkShareCount, alkBytesShare, opReturnShare, dieselShareCount, runesBytesShare, otherBytesShare,
  alkExDieselShareCount, alkOfOpReturnShare, bytesPerAlkanesTx, bytesPerOtherOpReturnTx,
  minerRevenueUsdDay, feeAlkanesShare, feeOpReturnShare, feePerAlkanesTx, feePerNonAlkanesTx, dieselMintsPerDay,
  utcDate, type HistoryRow, type Sums,
} from './history';

// Lê o history.csv e gera report.html (standalone, tema escuro) com:
//  - rollups (ontem / 7d / 30d / all)
//  - linha do tempo DIÁRIA (cada dia tem ~48 blocos amostrados → ponto sólido)
//  - share de DIESEL (mint 2:0 op77) por dia
// Uso: tsx tools/build-report.ts [historyPath]

const historyPath = process.argv[2] ?? 'history.csv';
const rows: HistoryRow[] = readHistory(historyPath);
if (rows.length === 0) {
  console.error(`history vazio (${historyPath}) — rode tools/snapshot.ts ou tools/seed-history.ts primeiro`);
  process.exit(1);
}

// Arquivo LATERAL (weight + UNCOMMON•GOODS por dia), gerado pelo indexer (tools/export-blockspace.ts
// no repo opreturn-indexer). Fica FORA do history.csv de 15 colunas — decisão de schema p/ não
// arriscar o CSV. Se ausente, os 2 gráficos novos simplesmente não renderizam (build não quebra).
interface BlockspaceDay {
  date: string; weightTotal: number; weightAlkanes: number;
  ugMints: number; dieselUg: number; dieselMints: number; blocksScanned: number;
}
const bsPath = join(dirname(historyPath) || '.', 'blockspace-daily.json');
const bsDays: BlockspaceDay[] = existsSync(bsPath) ? JSON.parse(readFileSync(bsPath, 'utf8')) : [];
const bsMap = new Map(bsDays.map((d) => [d.date, d]));
const hasBs = bsDays.length > 0;

const r1 = (x: number) => +(x * 100).toFixed(1);
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const mday = (iso: string) => { const [, m, d] = iso.split('-'); return `${MONTHS[+m - 1]} ${+d}`; };

// Receita do minerador no dia em BTC (fees extrapoladas amostra→144 blocos + subsídio 3,125 BTC).
// É o minerRevenueUsdDay sem o ×btcUsd — o tooltip do gráfico mostra esse BTC ao lado do USD.
const SUBSIDY_SATS = 312_500_000; // 3,125 BTC/bloco (heights 930000–955153)
const feeBtcDay = (r: HistoryRow): number =>
  r.blocksScanned ? (r.feeTotalSats / r.blocksScanned * 144 + 144 * SUBSIDY_SATS) / 1e8 : 0;
// Fees (SEM subsídio) extrapoladas pro dia inteiro, em BTC — separa o ganho do miner que vem de Alkanes
// vs o resto. O subsídio é fixo (3,125 BTC/bloco), então a parte que cresce com atividade é a fee.
const feeBtcOnly = (sats: number, blocks: number): number => (blocks ? (sats / blocks * 144) / 1e8 : 0);

const sumsOfRow = (r: HistoryRow): Sums => ({
  blocksScanned: r.blocksScanned, totalTx: r.totalTx, txWithOpReturn: r.txWithOpReturn,
  txAlkanes: r.txAlkanes, opReturnBytes: r.opReturnBytes, runestoneBytes: r.runestoneBytes, alkanesBytes: r.alkanesBytes, dieselMints: r.dieselMints,
  feeTotalSats: r.feeTotalSats, feeAlkanesSats: r.feeAlkanesSats, feeOpReturnSats: r.feeOpReturnSats,
});

const all = rollup(rows, '0000-00-00');
const lastRow = rows[rows.length - 1];
const latest = sumsOfRow(lastRow);
const d30 = rollup(rows, utcDate(-29));

// DIESEL como % das tx Alkanes (mostra que Alkanes ≈ DIESEL) no período inteiro
const dieselOfAlkanes = all.txAlkanes ? r1(all.dieselMints / all.txAlkanes) : 0;
// estimativa de mints/dia no full-day (extrapola a amostra: mints/blocosAmostrados × ~144)
const estDieselPerDay = Math.round((d30.dieselMints / Math.max(1, d30.blocksScanned)) * 144);

// composição dos bytes de OP_RETURN (all time): Alkanes / Runes / Other
const donutAlk = r1(alkBytesShare(all));
const donutRunes = r1(runesBytesShare(all));
const donutOther = r1(otherBytesShare(all));

// --- Métricas do arquivo lateral (indexer): blockspace literal (weight) + DIESEL∩UG ---
// Alinhadas às MESMAS datas de `rows` (lookup por data); dia sem dado lateral vira null (gap no gráfico).
const blockspaceDaily = rows.map((r) => {
  const b = bsMap.get(r.date);
  return b && b.weightTotal ? r1(b.weightAlkanes / b.weightTotal) : null;
});
const dieselUgDaily = rows.map((r) => {
  const b = bsMap.get(r.date);
  return b && b.ugMints ? r1(b.dieselUg / b.ugMints) : null;
});
const sumW = bsDays.reduce((a, d) => a + d.weightTotal, 0);
const sumWA = bsDays.reduce((a, d) => a + d.weightAlkanes, 0);
const sumUG = bsDays.reduce((a, d) => a + d.ugMints, 0);
const sumDUG = bsDays.reduce((a, d) => a + d.dieselUg, 0);
const blockspaceAll = sumW ? r1(sumWA / sumW) : 0;
const bsLast = bsDays[bsDays.length - 1];
const bsFirst = bsDays[0];
const blockspaceLast = bsLast && bsLast.weightTotal ? r1(bsLast.weightAlkanes / bsLast.weightTotal) : 0;
const dieselUgAll = sumUG ? r1(sumDUG / sumUG) : 0;
const dieselUgFirst = bsFirst && bsFirst.ugMints ? r1(bsFirst.dieselUg / bsFirst.ugMints) : 0;
const dieselUgLast = bsLast && bsLast.ugMints ? r1(bsLast.dieselUg / bsLast.ugMints) : 0;

// --- Séries dos 4 gráficos novos (genesis do DIESEL → hoje) ---
// #1 "denominador" (4 lentes): reusa txDaily/bytesDaily/feeAlkanesDaily/blockspaceDaily (já no data).
// As 4 respostas all-time pra "% do BTC que é Alkanes": por contagem / bytes / fee / weight.
const denCount = r1(alkShareCount(all));
const denBytes = r1(alkBytesShare(all));
const denFee = r1(feeAlkanesShare(all));
// (denWeight = blockspaceAll, já calculado acima)
// #2 DIESEL/dia (absoluto, extrapolado) + #4 acumulado desde o genesis.
const dieselPerDayDaily = rows.map((r) => { const v = Math.round(dieselMintsPerDay(r)); return v >= 1 ? v : null; });
let _accDsl = 0;
const dieselCumDaily = rows.map((r) => { _accDsl += dieselMintsPerDay(r); return Math.round(_accDsl); });
const dieselCumTotal = dieselCumDaily[dieselCumDaily.length - 1] ?? 0;
const dieselPeak = Math.max(0, ...dieselPerDayDaily);
// #3 fee média por tx (sats): Alkanes vs resto (é DIESEL "spam barato"?).
const feePerAlkTxDaily = rows.map((r) => Math.round(feePerAlkanesTx(sumsOfRow(r))));
const feePerOtherTxDaily = rows.map((r) => Math.round(feePerNonAlkanesTx(sumsOfRow(r))));

// --- "Pure Runes vs Alkanes" (o gráfico do Gabe): o FLIP dos bytes de OP_RETURN ---
// Séries já no `data`: bytesDaily = Alkanes (% dos bytes), runesDaily = Runes PUROS
// (Runestone que NÃO é Alkanes). Aqui só os números da nota: começo (30 primeiros dias) vs
// recente (30 últimos, = d30). O crossover Alkanes>Runes foi em abr/2025 (verificado no CSV).
const early30 = rollup(rows.slice(0, 30), '0000-00-00');
const runesEarly = r1(runesBytesShare(early30));
const alkEarly = r1(alkBytesShare(early30));
const runesRecent = r1(runesBytesShare(d30));
const alkRecent = r1(alkBytesShare(d30));

const data = {
  labels: rows.map((r) => mday(r.date)),
  txDaily: rows.map((r) => r1(alkShareCount(sumsOfRow(r)))),
  bytesDaily: rows.map((r) => r1(alkBytesShare(sumsOfRow(r)))),
  dieselDaily: rows.map((r) => r1(dieselShareCount(sumsOfRow(r)))),
  opReturnDaily: rows.map((r) => r1(opReturnShare(sumsOfRow(r)))),
  runesDaily: rows.map((r) => r1(runesBytesShare(sumsOfRow(r)))),
  alkExDieselDaily: rows.map((r) => r1(alkExDieselShareCount(sumsOfRow(r)))),
  alkOfOpReturnDaily: rows.map((r) => r1(alkOfOpReturnShare(sumsOfRow(r)))),
  feeAlkanesDaily: rows.map((r) => r1(feeAlkanesShare(sumsOfRow(r)))),
  feeUsdDaily: rows.map((r) => Math.round(minerRevenueUsdDay(r))),
  feeBtcDaily: rows.map((r) => +feeBtcDay(r).toFixed(2)),
  feeBtcAlkDaily: rows.map((r) => +feeBtcOnly(r.feeAlkanesSats, r.blocksScanned).toFixed(3)),
  feeBtcRestDaily: rows.map((r) => +feeBtcOnly(Math.max(0, r.feeTotalSats - r.feeAlkanesSats), r.blocksScanned).toFixed(3)),
  bytesAlkDaily: rows.map((r) => +bytesPerAlkanesTx(sumsOfRow(r)).toFixed(1)),
  bytesOtherDaily: rows.map((r) => +bytesPerOtherOpReturnTx(sumsOfRow(r)).toFixed(1)),
  blockspaceDaily,
  dieselUgDaily,
  dieselPerDayDaily,
  dieselCumDaily,
  feePerAlkTxDaily,
  feePerOtherTxDaily,
  donut: [donutAlk, donutRunes, donutOther],
  opReturnPie: [lastRow.txAlkanes, Math.max(0, lastRow.txWithOpReturn - lastRow.txAlkanes)],
  span: `${mday(rows[0].date)} – ${mday(rows[rows.length - 1].date)}`,
  days: rows.length,
  totalTx: all.totalTx,
};

const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Alkanes — share of Bitcoin OP_RETURN</title>
<style>
  :root{--bg:#0b0b0d;--surface:#16161a;--line:#26262c;--text:#ececef;--head:#f6f6f8;--muted:#9a9aa3;--faint:#6f6f78;--teal:#2DBE8E;--purple:#9d94e8;--amber:#E9A23B}
  *{box-sizing:border-box} body{font-family:system-ui,-apple-system,sans-serif;background:var(--bg);color:var(--text);max-width:880px;margin:0 auto;padding:2.5rem 1.25rem 3rem;line-height:1.6}
  h1{font-weight:600;font-size:23px;margin:0 0 4px;color:var(--head)} h2{font-weight:600;font-size:16px;margin:2.25rem 0 4px;color:var(--head)}
  .sub{color:var(--muted);font-size:13px;margin:0 0 1.5rem}
  .cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px;margin:1.25rem 0 1rem}
  .card{background:var(--surface);border:1px solid var(--line);border-radius:12px;padding:1rem 1.1rem}
  .card .l{font-size:13px;color:var(--muted)} .card .v{font-size:27px;font-weight:600;color:var(--head);margin-top:2px} .card .u{font-size:11px;color:var(--muted);margin-top:1px} .card .b{font-size:12px;color:var(--faint);margin-top:2px}
  .note{font-size:13px;color:var(--muted);margin:.25rem 0 0} .note b{color:var(--head);font-weight:600}
  .legend{display:flex;flex-wrap:wrap;gap:16px;margin:8px 0 10px;font-size:12px;color:var(--muted);align-items:center}
  .legend span[data-ds]{cursor:pointer;user-select:none} .legend span.off{opacity:.4;text-decoration:line-through}
  .sw{width:11px;height:11px;border-radius:3px;display:inline-block;margin-right:5px;vertical-align:middle}
  .range{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin:0 0 .4rem;font-size:13px;color:var(--muted)}
  .range button{background:var(--surface);border:1px solid var(--line);color:var(--muted);border-radius:7px;padding:4px 12px;font-size:12px;cursor:pointer;font-family:inherit}
  .range button.active{background:var(--teal);border-color:var(--teal);color:#04150f;font-weight:600}
  .chartnote{font-size:13px;color:var(--muted);margin:.1rem 0 1.6rem} .chartnote b{color:var(--head);font-weight:600} .chartnote i{color:var(--text)}
  .wrap{position:relative;width:100%;height:300px;margin-bottom:.5rem}
  .how{background:var(--surface);border:1px solid var(--line);border-radius:12px;padding:1.1rem 1.25rem;margin-top:.5rem}
  .how p{margin:0 0 .6rem;font-size:14px;color:var(--text)} .how p:last-child{margin-bottom:0} .how b{color:var(--head);font-weight:600}
  code{font-family:ui-monospace,monospace;background:#222228;border:1px solid var(--line);border-radius:5px;padding:1px 5px;font-size:12px;color:#d6d6db}
  a{color:var(--teal)} footer{margin-top:2rem;font-size:12px;color:var(--faint);border-top:1px solid var(--line);padding-top:1rem}
</style></head><body>
<h1>Alkanes' share of Bitcoin OP_RETURN</h1>
<p class="sub">${data.span} · ${data.days} days · ${data.totalTx.toLocaleString('en-US')} transactions sampled · updated daily</p>
<p class="note">Numbers you may see elsewhere can differ — they depend on the time window and whether they measure transactions vs bytes vs outputs (and whether the coinbase is included).</p>
<p class="note">Of all Alkanes activity, <b>${dieselOfAlkanes}%</b> is DIESEL minting (cellpack <code>2:0</code> op&nbsp;77) — roughly <b>${estDieselPerDay.toLocaleString('en-US')}</b> mints/day estimated over the last 30 days.</p>

<div class="range" id="range"><span>Time range:</span><button data-days="all" class="active">All time</button><button data-days="60">Last 60 days</button></div>
<p class="note" style="margin:0 0 1.25rem">The last 60 days are scanned at full density (every block); the older history is sampled — the percentages are equivalent either way.</p>

<h2>Daily Alkanes share</h2>
<div class="legend" id="leg-g"><span data-ds="0"><span class="sw" style="background:var(--teal)"></span>OP_RETURN bytes</span><span data-ds="1"><span class="sw" style="background:var(--purple)"></span>Transactions</span><span data-ds="2"><span class="sw" style="background:var(--faint)"></span>OP_RETURN penetration</span><span data-ds="3"><span class="sw" style="background:var(--amber)"></span>Runes (bytes)</span><span data-ds="4"><span class="sw" style="background:#4bb8d9"></span>Alkanes excl. DIESEL (tx)</span></div>
<div class="wrap"><canvas id="g"></canvas></div>
<p class="chartnote">Tip: click a legend item to show/hide its line.</p>

<h2>Alkanes' share of OP_RETURN</h2>
<div class="legend" id="leg-o"><span data-ds="0"><span class="sw" style="background:var(--teal)"></span>% of OP_RETURN transactions</span><span data-ds="1"><span class="sw" style="background:var(--purple)"></span>% of OP_RETURN bytes</span></div>
<div class="wrap"><canvas id="o"></canvas></div>
<p class="chartnote">Of every Bitcoin transaction that carries an OP_RETURN, <b>${r1(alkOfOpReturnShare(d30))}%</b> are Alkanes (last 30 days), and they account for <b>${r1(alkBytesShare(d30))}%</b> of all OP_RETURN data bytes. This is Alkanes' grip on OP_RETURN itself — independent of how many BTC tx use OP_RETURN at all.</p>
<p class="chartnote">Tip: click a legend item to show/hide its line.</p>
${hasBs ? `
<h2>Alkanes' share of block space (by weight)</h2>
<div class="legend"><span><span class="sw" style="background:var(--teal)"></span>Alkanes — % of total block weight</span></div>
<div class="wrap"><canvas id="bs"></canvas></div>
<p class="chartnote">This is the <b>literal block space</b> Alkanes occupy — transaction <i>weight</i>, the unit Bitcoin's block limit is actually denominated in (not byte counts, not transaction counts). Alkanes were <b>${blockspaceAll}%</b> of all block weight over the period and <b>${blockspaceLast}%</b> on the last measured day, up from under 1% at the start of the year. This is the honest "how much of Bitcoin is Alkanes" answer: by weight they are still a minority of block space, far below their share of transaction <i>count</i> (most Alkanes tx are tiny DIESEL mints). Measured directly from each transaction's weight via a metashrew/alkanes-rs indexer.</p>
` : ''}
<h2>How much of Bitcoin is Alkanes? Four answers</h2>
<div class="legend" id="leg-den"><span data-ds="0"><span class="sw" style="background:var(--purple)"></span>By transaction count</span><span data-ds="1"><span class="sw" style="background:var(--teal)"></span>By OP_RETURN bytes</span><span data-ds="2"><span class="sw" style="background:#4bb8d9"></span>By block weight</span><span data-ds="3"><span class="sw" style="background:var(--amber)"></span>By miner fee revenue</span></div>
<div class="wrap"><canvas id="den"></canvas></div>
<p class="chartnote">The one chart that ties it together: <b>"how much of Bitcoin is Alkanes?" has no single answer</b> — it depends on what you measure. By raw <b>transaction count</b> Alkanes are <b>${denCount}%</b> all-time (but nearly all of that is tiny DIESEL mints); by <b>OP_RETURN bytes</b> <b>${denBytes}%</b>; by <b>block weight</b> — the literal space Bitcoin's block limit is denominated in — <b>${blockspaceAll}%</b>; and by <b>miner fee revenue</b>, what actually pays for that space, just <b>${denFee}%</b>. The story is the <i>spread</i> between the four lines: Alkanes dominate by count but are a modest slice by the economic measures.${hasBs ? '' : ' (The block-weight line needs the indexer side-file.)'}</p>
<p class="chartnote">Tip: click a legend item to show/hide its line.</p>

<h2>Last day — share of OP_RETURN transactions</h2>
<div class="legend"><span><span class="sw" style="background:var(--teal)"></span>Alkanes ${r1(alkOfOpReturnShare(latest))}%</span><span><span class="sw" style="background:#4a4a52"></span>Other OP_RETURN ${r1(1 - alkOfOpReturnShare(latest))}%</span></div>
<div class="wrap" style="height:250px;max-width:380px"><canvas id="op"></canvas></div>
<p class="chartnote"><b>How this is calculated.</b> Last day = ${mday(lastRow.date)} (Bitcoin blocks ${lastRow.fromHeight.toLocaleString('en-US')}–${lastRow.toHeight.toLocaleString('en-US')}, ${lastRow.blocksScanned} sampled). Of <b>${lastRow.txWithOpReturn.toLocaleString('en-US')}</b> transactions carrying an OP_RETURN that day, <b>${lastRow.txAlkanes.toLocaleString('en-US')}</b> were Alkanes &rarr; <b>${r1(alkOfOpReturnShare(latest))}%</b>. Share = Alkanes OP_RETURN tx &divide; all OP_RETURN tx. A transaction counts as Alkanes when one of its OP_RETURN outputs decodes as a Runestone whose protostone carries <code>protocol_tag = 1</code> (via the open-source <a href="https://github.com/Vdto88/alkanes-opreturn-decoder">alkanes-opreturn-decoder</a>).</p>

<h2>DIESEL mints — share of all Bitcoin transactions</h2>
<div class="legend"><span><span class="sw" style="background:var(--amber)"></span>DIESEL mints (% of all tx)</span></div>
<div class="wrap" style="height:240px"><canvas id="m"></canvas></div>

<h2>DIESEL mints per day — the birth curve</h2>
<div class="legend"><span><span class="sw" style="background:var(--amber)"></span>Estimated DIESEL mints/day (log scale)</span></div>
<div class="wrap" style="height:260px"><canvas id="dpd"></canvas></div>
<p class="chartnote">DIESEL was born at block 880,000 on <b>Jan 20 2025</b>. This is the raw volume — estimated mints per day (sampled blocks &times; 144) — on a <b>log scale</b> so the beginning stays visible: from a handful a day early in 2025 to a peak of about <b>${dieselPeak.toLocaleString('en-US')}/day</b>. The take-off around Aug–Sep 2025 is when DIESEL minting exploded (and began riding UNCOMMON•GOODS).</p>

<h2>DIESEL minted — cumulative since genesis</h2>
<div class="legend"><span><span class="sw" style="background:var(--amber)"></span>Total DIESEL mints since Jan 20 2025</span></div>
<div class="wrap" style="height:240px"><canvas id="dcum"></canvas></div>
<p class="chartnote">Running total of DIESEL mints since genesis — roughly <b>${(dieselCumTotal / 1e6).toFixed(1)}M</b> mints to date. Estimated by extrapolating each day's sampled blocks to the full day; the curve's slope is the daily rate above.</p>
${hasBs ? `
<h2>UNCOMMON•GOODS mints that are DIESEL</h2>
<div class="legend"><span><span class="sw" style="background:var(--amber)"></span>DIESEL share of UNCOMMON•GOODS mints</span></div>
<div class="wrap" style="height:240px"><canvas id="dug"></canvas></div>
<p class="chartnote">UNCOMMON•GOODS (Rune <code>1:0</code>) rides along on almost every DIESEL mint. Of all UNCOMMON•GOODS mints each day, the share that are <i>also</i> DIESEL climbed from <b>${dieselUgFirst}%</b> early in the year to <b>${dieselUgLast}%</b> recently (<b>${dieselUgAll}%</b> over the whole period): when you see an UNCOMMON•GOODS mint today, it is almost always DIESEL "wearing Runes clothing." Detected as a runestone whose <code>mint</code> is Rune <code>1:0</code> on a DIESEL (cellpack <code>2:0</code> op&nbsp;77) transaction.</p>
` : ''}
<h2>Pure Runes vs Alkanes — share of OP_RETURN bytes</h2>
<div class="legend" id="leg-rva"><span data-ds="0"><span class="sw" style="background:var(--teal)"></span>Alkanes</span><span data-ds="1"><span class="sw" style="background:var(--amber)"></span>Pure Runes (Runestone, <i>not</i> Alkanes)</span></div>
<div class="wrap"><canvas id="rva"></canvas></div>
<p class="chartnote">The honest answer to <i>"if I see UNCOMMON•GOODS / Runestone mints in almost every transaction, isn't the network mostly Runes?"</i> — <b>No.</b> ${hasBs ? `It only looks that way because <b>~${dieselUgAll}%</b> of those UNCOMMON•GOODS mints are DIESEL (chart above)` : `It only looks that way because almost all of those UNCOMMON•GOODS / Runestone mints are actually DIESEL`} — Alkanes riding <i>inside</i> a Runestone envelope. Strip those out and count only <b>pure Runes</b> (Runestone OP_RETURN that is <i>not</i> Alkanes) and the picture flips: pure Runes fell from <b>${runesEarly}%</b> of OP_RETURN bytes at the start (early 2025) to <b>${runesRecent}%</b> in the last 30 days, while Alkanes rose from <b>${alkEarly}%</b> to <b>${alkRecent}%</b>. The two lines <b>crossed over in April 2025</b> and never went back. Over the whole period Alkanes are <b>${donutAlk}%</b> of OP_RETURN bytes versus just <b>${donutRunes}%</b> pure Runes. The data on-chain is <b>Alkanes, not Runes.</b></p>
<p class="chartnote">Tip: click a legend item to show/hide its line.</p>

<h2>OP_RETURN bytes (all time)</h2>
<div class="legend"><span><span class="sw" style="background:var(--teal)"></span>Alkanes ${donutAlk}%</span><span><span class="sw" style="background:var(--amber)"></span>Runes ${donutRunes}%</span><span><span class="sw" style="background:#4a4a52"></span>Other ${donutOther}%</span></div>
<div class="wrap" style="height:230px;max-width:360px"><canvas id="d"></canvas></div>

<h2>OP_RETURN bytes per transaction</h2>
<div class="legend"><span><span class="sw" style="background:var(--teal)"></span>Alkanes</span><span><span class="sw" style="background:var(--amber)"></span>Other OP_RETURN (non-Alkanes)</span></div>
<div class="wrap" style="height:240px"><canvas id="eff"></canvas></div>
<p class="chartnote">Alkanes' OP_RETURN payload is small and <b>stable</b> (~${bytesPerAlkanesTx(d30).toFixed(1)} bytes/tx), while the rest of OP_RETURN traffic is larger and more volatile — Alkanes are byte-efficient on-chain. (Bytes = full OP_RETURN output script.)</p>

<h2>Miner fee revenue</h2>
<div class="legend"><span><span class="sw" style="background:var(--amber)"></span>Total miner revenue — fees + subsidy (USD/day)</span></div>
<div class="wrap"><canvas id="f"></canvas></div>
<p class="chartnote">Alkanes transactions paid <b>${r1(feeAlkanesShare(all))}%</b> of all miner fee revenue over the period (<b>${r1(feeAlkanesShare(d30))}%</b> last 30 days); every OP_RETURN-carrying tx together paid <b>${r1(feeOpReturnShare(all))}%</b>. By <i>fee revenue</i> Alkanes are a far smaller slice than by transaction count — most Alkanes tx are tiny DIESEL mints.</p>
<p class="chartnote">Daily revenue extrapolates the sampled blocks to a full day (×144 ÷ blocks sampled) and adds the <b>3.125 BTC</b>/block subsidy, converted to USD at that day's BTC price. Tooltip shows the BTC figure; days before the price source's range show $0 (BTC still valid). The USD swings above are mostly the <i>BTC price</i> — the activity-driven part of miner income is the fees, shown next in BTC.</p>

<h2>Miner fee revenue from fees (BTC) — Alkanes vs rest</h2>
<div class="legend" id="leg-fb"><span data-ds="0"><span class="sw" style="background:var(--teal)"></span>Alkanes fees</span><span data-ds="1"><span class="sw" style="background:var(--faint)"></span>Other fees</span></div>
<div class="wrap"><canvas id="fb"></canvas></div>
<p class="chartnote">The block subsidy is a fixed <b>3.125 BTC</b>/block, so the part of miner income that grows with on-chain activity is the <b>fees</b>. This shows daily fees in BTC, split into what Alkanes transactions paid vs everything else — so you can see Alkanes' real contribution to miners' BTC earnings as Alkanes activity grows. <b>How this is calculated.</b> Per-day fees = (sum of tx fees &divide; blocks sampled &times; 144) &divide; 1e8 BTC; Alkanes = tx whose protostone carries <code>protocol_tag = 1</code>. Subsidy excluded.</p>
<p class="chartnote">Tip: click a legend item to show/hide its line (stacked = total fees).</p>

<h2>Alkanes' share of miner fee revenue</h2>
<div class="legend"><span><span class="sw" style="background:var(--teal)"></span>Alkanes — % of daily fee revenue</span></div>
<div class="wrap" style="height:240px"><canvas id="fa"></canvas></div>
<p class="chartnote">By <i>fee revenue</i> — what miners actually earn from fees — Alkanes are <b>${r1(feeAlkanesShare(d30))}%</b> over the last 30 days, far below their share of transaction <i>count</i>, because most Alkanes tx are tiny DIESEL mints that pay little. (Subsidy excluded here; fees only.)</p>

<h2>Fee per transaction — Alkanes vs everyone else</h2>
<div class="legend" id="leg-fpt"><span data-ds="0"><span class="sw" style="background:var(--teal)"></span>Alkanes tx (avg sats)</span><span data-ds="1"><span class="sw" style="background:var(--amber)"></span>Non-Alkanes tx (avg sats)</span></div>
<div class="wrap" style="height:260px"><canvas id="fpt"></canvas></div>
<p class="chartnote">Is DIESEL just cheap spam? This is the <b>average fee a single transaction pays</b> — Alkanes vs everything else. Over the last 30 days an Alkanes tx paid ~<b>${Math.round(feePerAlkanesTx(d30)).toLocaleString('en-US')}</b> sats on average vs ~<b>${Math.round(feePerNonAlkanesTx(d30)).toLocaleString('en-US')}</b> sats for a non-Alkanes tx. So even though Alkanes are a large share of transaction <i>count</i>, each one pays comparatively little — which is exactly why their share of <i>fee revenue</i> stays small.</p>

<h2>How it's calculated</h2>
<div class="how">
  <p>We read every Bitcoin block in the window and inspect each transaction's outputs. An output whose script starts with <code>6a</code> is an <b>OP_RETURN</b>; one starting <code>6a5d</code> is a Runestone.</p>
  <p>We decode the Runestone and if any protostone carries <b>protocol_tag = 1</b>, the transaction is <b>Alkanes</b>. A <b>DIESEL mint</b> is the specific case where the cellpack targets <code>2:0</code> with opcode <code>77</code> (the genesis alkane) — today that's the vast majority of all Alkanes activity.</p>
  <p><b>Share of transactions</b> = matching tx ÷ all tx. <b>Share of OP_RETURN bytes</b> = Alkanes OP_RETURN bytes ÷ all OP_RETURN bytes. Shares are unaffected by sampling; each day rests on ~24-48 sampled blocks (see <code>blocksScanned</code> in the CSV). Classification reuses the open-source <a href="https://github.com/Vdto88/alkanes-opreturn-decoder">alkanes-opreturn-decoder</a>.</p>
  <p><b>Glossary.</b> <b>OP_RETURN penetration</b>: share of all BTC tx that carry an OP_RETURN. <b>Alkanes (tx)</b>: share of all BTC tx that are Alkanes. <b>Alkanes (bytes)</b>: share of OP_RETURN bytes that are Alkanes. <b>Runes</b>: OP_RETURN bytes that are Runestones but not Alkanes. <b>Alkanes excl. DIESEL</b>: Alkanes tx that aren't DIESEL mints — "real app" usage. <b>DIESEL</b>: mint of the genesis alkane (cellpack <code>2:0</code> op&nbsp;77). <b>Alkanes of OP_RETURN</b>: of tx that carry an OP_RETURN, the share that are Alkanes (by tx and by bytes). <b>Bytes per tx</b>: average OP_RETURN script size per transaction in each bucket. <b>Alkanes share of fee revenue</b>: Alkanes fees ÷ total fees (subsidy excluded).${hasBs ? ` <b>Share of block space (by weight)</b>: Alkanes tx weight ÷ total block weight — weight is the unit Bitcoin's 4M-weight-unit block limit is denominated in, so this is literal block space. <b>UNCOMMON•GOODS that are DIESEL</b>: of runestone mints of Rune <code>1:0</code> (UNCOMMON•GOODS), the share that are also DIESEL mints. Block weight and UNCOMMON•GOODS come from a metashrew/alkanes-rs indexer that reads each block directly.` : ''}</p>
</div>
<footer>Source data: <a href="./history.csv">history.csv</a> (one row per day). Bytes = full output script; coinbase included. Auto-updated daily from the alkanes-opreturn-scanner.</footer>
<script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js"></script>
<script>
const D=${JSON.stringify(data)};
Chart.defaults.color='#9a9aa3'; Chart.defaults.font.family='system-ui,sans-serif';
const pc=v=>v+'%', grid='rgba(255,255,255,0.07)';
const gChart=new Chart(g,{type:'line',data:{labels:D.labels,datasets:[
 {label:'OP_RETURN bytes',data:D.bytesDaily,borderColor:'#2DBE8E',fill:false,pointRadius:1.5,tension:.25,borderWidth:2},
 {label:'Transactions',data:D.txDaily,borderColor:'#9d94e8',fill:false,pointRadius:1.5,tension:.25,borderWidth:2},
 {label:'OP_RETURN penetration',data:D.opReturnDaily,borderColor:'#6f6f78',borderDash:[4,3],fill:false,pointRadius:1.5,tension:.25,borderWidth:2},
 {label:'Runes (bytes)',data:D.runesDaily,borderColor:'#E9A23B',fill:false,pointRadius:1.5,tension:.25,borderWidth:2},
 {label:'Alkanes excl. DIESEL (tx)',data:D.alkExDieselDaily,borderColor:'#4bb8d9',borderDash:[4,3],fill:false,pointRadius:1.5,tension:.25,borderWidth:2}]},
 options:{responsive:true,maintainAspectRatio:false,interaction:{mode:'index',intersect:false},plugins:{legend:{display:false},tooltip:{callbacks:{label:c=>c.dataset.label+': '+c.parsed.y+'%'}}},scales:{y:{min:0,max:100,grid:{color:grid},ticks:{callback:pc,stepSize:20}},x:{grid:{display:false},ticks:{maxRotation:45,autoSkip:true,maxTicksLimit:12}}}}});
function wireLegend(id,chart){const leg=document.getElementById(id);if(!leg)return;leg.querySelectorAll('span[data-ds]').forEach(el=>{el.addEventListener('click',()=>{const i=+el.dataset.ds;const vis=chart.isDatasetVisible(i);chart.setDatasetVisibility(i,!vis);el.classList.toggle('off',vis);chart.update();});});}
wireLegend('leg-g',gChart);
const mChart=new Chart(m,{type:'line',data:{labels:D.labels,datasets:[
 {label:'DIESEL mints',data:D.dieselDaily,borderColor:'#E9A23B',backgroundColor:'rgba(233,162,59,0.12)',fill:true,pointRadius:1.5,tension:.25,borderWidth:2}]},
 options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false},tooltip:{callbacks:{label:c=>c.parsed.y+'% of all tx'}}},scales:{y:{min:0,max:100,grid:{color:grid},ticks:{callback:pc,stepSize:20}},x:{grid:{display:false},ticks:{maxRotation:45,autoSkip:true,maxTicksLimit:12}}}}});
new Chart(d,{type:'doughnut',data:{labels:['Alkanes','Runes','Other'],datasets:[{data:D.donut,backgroundColor:['#2DBE8E','#E9A23B','#4a4a52'],borderWidth:0}]},options:{responsive:true,maintainAspectRatio:false,cutout:'62%',plugins:{legend:{display:false},tooltip:{callbacks:{label:c=>c.label+': '+c.parsed+'%'}}}}});
new Chart(op,{type:'pie',data:{labels:['Alkanes','Other OP_RETURN'],datasets:[{data:D.opReturnPie,backgroundColor:['#2DBE8E','#4a4a52'],borderWidth:0}]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false},tooltip:{callbacks:{label:c=>{const t=c.dataset.data.reduce((a,b)=>a+b,0);return c.label+': '+c.parsed.toLocaleString('en-US')+' tx ('+(t?c.parsed/t*100:0).toFixed(1)+'%)';}}}}}});
const fChart=new Chart(f,{type:'line',data:{labels:D.labels,datasets:[{label:'Miner fee revenue (USD/day)',data:D.feeUsdDaily,borderColor:'#E9A23B',fill:true,backgroundColor:'rgba(233,162,59,0.12)',pointRadius:1,tension:.25,borderWidth:2}]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false},tooltip:{callbacks:{label:c=>'$'+c.parsed.y.toLocaleString('en-US')+' ('+D.feeBtcDaily[c.dataIndex]+' BTC)'}}},scales:{y:{grid:{color:grid},ticks:{callback:v=>'$'+(v/1e6).toFixed(1)+'M'}},x:{grid:{display:false},ticks:{maxRotation:45,autoSkip:true,maxTicksLimit:10}}}}});
const fbChart=new Chart(fb,{type:'line',data:{labels:D.labels,datasets:[
 {label:'Alkanes fees',data:D.feeBtcAlkDaily,borderColor:'#2DBE8E',backgroundColor:'rgba(45,190,142,0.30)',fill:true,pointRadius:0,tension:.25,borderWidth:1.5,stack:'f'},
 {label:'Other fees',data:D.feeBtcRestDaily,borderColor:'#6f6f78',backgroundColor:'rgba(120,120,128,0.20)',fill:true,pointRadius:0,tension:.25,borderWidth:1.5,stack:'f'}]},
 options:{responsive:true,maintainAspectRatio:false,interaction:{mode:'index',intersect:false},plugins:{legend:{display:false},tooltip:{callbacks:{label:c=>c.dataset.label+': '+c.parsed.y+' BTC'}}},scales:{y:{min:0,stacked:true,grid:{color:grid},ticks:{callback:v=>v+' BTC'}},x:{grid:{display:false},ticks:{maxRotation:45,autoSkip:true,maxTicksLimit:10}}}}});
wireLegend('leg-fb',fbChart);
const oChart=new Chart(o,{type:'line',data:{labels:D.labels,datasets:[
 {label:'% of OP_RETURN transactions',data:D.alkOfOpReturnDaily,borderColor:'#2DBE8E',fill:false,pointRadius:1.5,tension:.25,borderWidth:2.5},
 {label:'% of OP_RETURN bytes',data:D.bytesDaily,borderColor:'#9d94e8',fill:false,pointRadius:1.5,tension:.25,borderWidth:2}]},
 options:{responsive:true,maintainAspectRatio:false,interaction:{mode:'index',intersect:false},plugins:{legend:{display:false},tooltip:{callbacks:{label:c=>c.dataset.label+': '+c.parsed.y+'%'}}},scales:{y:{min:0,max:100,grid:{color:grid},ticks:{callback:pc,stepSize:20}},x:{grid:{display:false},ticks:{maxRotation:45,autoSkip:true,maxTicksLimit:12}}}}});
wireLegend('leg-o',oChart);
const effChart=new Chart(eff,{type:'line',data:{labels:D.labels,datasets:[
 {label:'Alkanes',data:D.bytesAlkDaily,borderColor:'#2DBE8E',fill:false,pointRadius:1,tension:.25,borderWidth:2},
 {label:'Other OP_RETURN',data:D.bytesOtherDaily,borderColor:'#E9A23B',fill:false,pointRadius:1,tension:.25,borderWidth:2}]},
 options:{responsive:true,maintainAspectRatio:false,interaction:{mode:'index',intersect:false},plugins:{legend:{display:false},tooltip:{callbacks:{label:c=>c.dataset.label+': '+c.parsed.y+' B'}}},scales:{y:{min:0,grid:{color:grid},ticks:{callback:v=>v+' B'}},x:{grid:{display:false},ticks:{maxRotation:45,autoSkip:true,maxTicksLimit:12}}}}});
const faChart=new Chart(fa,{type:'line',data:{labels:D.labels,datasets:[
 {label:'Alkanes share of fees',data:D.feeAlkanesDaily,borderColor:'#2DBE8E',backgroundColor:'rgba(45,190,142,0.12)',fill:true,pointRadius:1,tension:.25,borderWidth:2}]},
 options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false},tooltip:{callbacks:{label:c=>c.parsed.y+'% of fee revenue'}}},scales:{y:{min:0,max:100,grid:{color:grid},ticks:{callback:pc,stepSize:20}},x:{grid:{display:false},ticks:{maxRotation:45,autoSkip:true,maxTicksLimit:12}}}}});
// #1 "denominador": as 4 lentes de "% do BTC que é Alkanes" num só gráfico (a tese)
const denChart=new Chart(den,{type:'line',data:{labels:D.labels,datasets:[
 {label:'By transaction count',data:D.txDaily,borderColor:'#9d94e8',fill:false,pointRadius:1,tension:.25,borderWidth:2},
 {label:'By OP_RETURN bytes',data:D.bytesDaily,borderColor:'#2DBE8E',fill:false,pointRadius:1,tension:.25,borderWidth:2},
 {label:'By block weight',data:D.blockspaceDaily,borderColor:'#4bb8d9',fill:false,pointRadius:1,tension:.25,borderWidth:2.5,spanGaps:false},
 {label:'By miner fee revenue',data:D.feeAlkanesDaily,borderColor:'#E9A23B',fill:false,pointRadius:1,tension:.25,borderWidth:2}]},
 options:{responsive:true,maintainAspectRatio:false,interaction:{mode:'index',intersect:false},plugins:{legend:{display:false},tooltip:{callbacks:{label:c=>c.dataset.label+': '+c.parsed.y+'%'}}},scales:{y:{min:0,max:100,grid:{color:grid},ticks:{callback:pc,stepSize:20}},x:{grid:{display:false},ticks:{maxRotation:45,autoSkip:true,maxTicksLimit:12}}}}});
wireLegend('leg-den',denChart);
// #2 DIESEL/dia (absoluto, escala log — mostra o nascimento + a explosão)
const dpdChart=new Chart(dpd,{type:'line',data:{labels:D.labels,datasets:[
 {label:'DIESEL mints/day',data:D.dieselPerDayDaily,borderColor:'#E9A23B',backgroundColor:'rgba(233,162,59,0.12)',fill:true,pointRadius:0.5,tension:.25,borderWidth:2,spanGaps:false}]},
 options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false},tooltip:{callbacks:{label:c=>c.parsed.y.toLocaleString('en-US')+' mints/day'}}},scales:{y:{type:'logarithmic',grid:{color:grid},ticks:{callback:v=>{const l=Math.log10(v);return l===Math.floor(l)?(v>=1000?(v/1000)+'k':''+v):'';}}},x:{grid:{display:false},ticks:{maxRotation:45,autoSkip:true,maxTicksLimit:12}}}}});
// #4 DIESEL acumulado (linear, área — escala total)
const dcumChart=new Chart(dcum,{type:'line',data:{labels:D.labels,datasets:[
 {label:'Cumulative DIESEL mints',data:D.dieselCumDaily,borderColor:'#E9A23B',backgroundColor:'rgba(233,162,59,0.15)',fill:true,pointRadius:0,tension:.25,borderWidth:2}]},
 options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false},tooltip:{callbacks:{label:c=>c.parsed.y.toLocaleString('en-US')+' total mints'}}},scales:{y:{min:0,grid:{color:grid},ticks:{callback:v=>(v/1e6).toFixed(0)+'M'}},x:{grid:{display:false},ticks:{maxRotation:45,autoSkip:true,maxTicksLimit:12}}}}});
// #3 fee média por tx (sats): Alkanes vs resto
const fptChart=new Chart(fpt,{type:'line',data:{labels:D.labels,datasets:[
 {label:'Alkanes tx',data:D.feePerAlkTxDaily,borderColor:'#2DBE8E',fill:false,pointRadius:0.5,tension:.25,borderWidth:2},
 {label:'Non-Alkanes tx',data:D.feePerOtherTxDaily,borderColor:'#E9A23B',fill:false,pointRadius:0.5,tension:.25,borderWidth:2}]},
 options:{responsive:true,maintainAspectRatio:false,interaction:{mode:'index',intersect:false},plugins:{legend:{display:false},tooltip:{callbacks:{label:c=>c.dataset.label+': '+c.parsed.y.toLocaleString('en-US')+' sats'}}},scales:{y:{min:0,grid:{color:grid},ticks:{callback:v=>v.toLocaleString('en-US')}},x:{grid:{display:false},ticks:{maxRotation:45,autoSkip:true,maxTicksLimit:12}}}}});
wireLegend('leg-fpt',fptChart);
// Gabe: "Pure Runes vs Alkanes" — o flip dos bytes de OP_RETURN (Runes puros caindo, Alkanes subindo, crossover abr/2025)
const rvaChart=new Chart(rva,{type:'line',data:{labels:D.labels,datasets:[
 {label:'Alkanes',data:D.bytesDaily,borderColor:'#2DBE8E',backgroundColor:'rgba(45,190,142,0.12)',fill:true,pointRadius:1,tension:.25,borderWidth:2.5},
 {label:'Pure Runes',data:D.runesDaily,borderColor:'#E9A23B',backgroundColor:'rgba(233,162,59,0.12)',fill:true,pointRadius:1,tension:.25,borderWidth:2.5}]},
 options:{responsive:true,maintainAspectRatio:false,interaction:{mode:'index',intersect:false},plugins:{legend:{display:false},tooltip:{callbacks:{label:c=>c.dataset.label+': '+c.parsed.y+'%'}}},scales:{y:{min:0,max:100,grid:{color:grid},ticks:{callback:pc,stepSize:20}},x:{grid:{display:false},ticks:{maxRotation:45,autoSkip:true,maxTicksLimit:12}}}}});
wireLegend('leg-rva',rvaChart);
${hasBs ? `
const bsChart=new Chart(bs,{type:'line',data:{labels:D.labels,datasets:[
 {label:'Alkanes share of block weight',data:D.blockspaceDaily,borderColor:'#2DBE8E',backgroundColor:'rgba(45,190,142,0.12)',fill:true,pointRadius:1,tension:.25,borderWidth:2,spanGaps:false}]},
 options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false},tooltip:{callbacks:{label:c=>c.parsed.y+'% of block weight'}}},scales:{y:{min:0,max:100,grid:{color:grid},ticks:{callback:pc,stepSize:20}},x:{grid:{display:false},ticks:{maxRotation:45,autoSkip:true,maxTicksLimit:12}}}}});
const dugChart=new Chart(dug,{type:'line',data:{labels:D.labels,datasets:[
 {label:'DIESEL share of UNCOMMON•GOODS mints',data:D.dieselUgDaily,borderColor:'#E9A23B',backgroundColor:'rgba(233,162,59,0.12)',fill:true,pointRadius:1,tension:.25,borderWidth:2,spanGaps:false}]},
 options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false},tooltip:{callbacks:{label:c=>c.parsed.y+'% are DIESEL'}}},scales:{y:{min:0,max:100,grid:{color:grid},ticks:{callback:pc,stepSize:20}},x:{grid:{display:false},ticks:{maxRotation:45,autoSkip:true,maxTicksLimit:12}}}}});
` : ''}
// Filtro de janela temporal (todos os gráficos de LINHA): seta x.min pela data, sem fatiar dados
// (mantém c.dataIndex alinhado aos arrays de D, então tooltips seguem corretos). Rosca/pizza ficam fixas.
const lineCharts=[gChart,mChart,fChart,oChart,effChart,fbChart,faChart,denChart,dpdChart,dcumChart,fptChart,rvaChart];
${hasBs ? `lineCharts.push(bsChart,dugChart);` : ''}
function setRange(days){
  const min = days==='all' ? D.labels[0] : D.labels[Math.max(0, D.labels.length - days)];
  for(const c of lineCharts){ c.options.scales.x.min = min; c.update(); }
}
document.querySelectorAll('#range button').forEach(b=>{b.addEventListener('click',()=>{
  document.querySelectorAll('#range button').forEach(x=>x.classList.remove('active'));
  b.classList.add('active');
  setRange(b.dataset.days==='all' ? 'all' : +b.dataset.days);
});});
</script></body></html>`;

writeFileSync('report.html', html);
console.log(`report.html: ${data.days} dias (${data.span}) · 30d tx=${r1(alkShareCount(d30))}% · DIESEL=${dieselOfAlkanes}% das Alkanes · ~${estDieselPerDay}/dia`);
