import { writeFileSync } from 'node:fs';
import {
  readHistory, rollup, alkShareCount, alkBytesShare, utcDate, type HistoryRow, type Sums,
} from './history';

// Lê o history.csv e gera report.html (standalone, tema escuro) com:
//  - rollups (ontem / 7d / 30d / all)
//  - linha do tempo: média móvel de 7 dias (ponderada por blocos) + pontos diários
//  - explicação de como é calculado
// Uso: tsx tools/build-report.ts [historyPath]

const historyPath = process.argv[2] ?? 'history.csv';
const rows: HistoryRow[] = readHistory(historyPath);
if (rows.length === 0) {
  console.error(`history vazio (${historyPath}) — rode tools/snapshot.ts ou tools/seed-history.ts primeiro`);
  process.exit(1);
}

const r1 = (x: number) => +(x * 100).toFixed(1);
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const mday = (iso: string) => { const [, m, d] = iso.split('-'); return `${MONTHS[+m - 1]} ${+d}`; };

const sumsOfRow = (r: HistoryRow): Sums => ({
  blocks: r.blocks, totalTx: r.totalTx, txWithOpReturn: r.txWithOpReturn,
  txAlkanes: r.txAlkanes, opReturnBytes: r.opReturnBytes, alkanesBytes: r.alkanesBytes,
});

// média móvel de 7 dias ponderada por blocos (= soma das contagens na janela)
const rollAt = (i: number, num: keyof HistoryRow, den: keyof HistoryRow): number => {
  let a = 0, b = 0;
  for (let j = Math.max(0, i - 6); j <= i; j++) { a += rows[j][num] as number; b += rows[j][den] as number; }
  return b ? a / b : 0;
};

const all = rollup(rows, '0000-00-00');
const latest = sumsOfRow(rows[rows.length - 1]);
const d7 = rollup(rows, utcDate(-6));
const d30 = rollup(rows, utcDate(-29));

const card = (label: string, s: Sums) =>
  `<div class="card"><div class="l">${label}</div><div class="v">${r1(alkShareCount(s))}%</div><div class="b">${r1(alkBytesShare(s))}% of bytes</div></div>`;

const data = {
  labels: rows.map((r) => mday(r.date)),
  txDaily: rows.map((r) => r1(alkShareCount(sumsOfRow(r)))),
  txRoll: rows.map((_, i) => r1(rollAt(i, 'txAlkanes', 'totalTx'))),
  bytesRoll: rows.map((_, i) => r1(rollAt(i, 'alkanesBytes', 'opReturnBytes'))),
  donutAlk: r1(alkBytesShare(all)),
  span: `${mday(rows[0].date)} – ${mday(rows[rows.length - 1].date)}`,
  days: rows.length,
  totalTx: all.totalTx,
};

const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Alkanes — share of Bitcoin OP_RETURN</title>
<style>
  :root{--bg:#0b0b0d;--surface:#16161a;--line:#26262c;--text:#ececef;--head:#f6f6f8;--muted:#9a9aa3;--faint:#6f6f78;--teal:#2DBE8E;--purple:#9d94e8}
  *{box-sizing:border-box} body{font-family:system-ui,-apple-system,sans-serif;background:var(--bg);color:var(--text);max-width:880px;margin:0 auto;padding:2.5rem 1.25rem 3rem;line-height:1.6}
  h1{font-weight:600;font-size:23px;margin:0 0 4px;color:var(--head)} h2{font-weight:600;font-size:16px;margin:2.25rem 0 4px;color:var(--head)}
  .sub{color:var(--muted);font-size:13px;margin:0 0 1.5rem}
  .cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px;margin:1.25rem 0 1.75rem}
  .card{background:var(--surface);border:1px solid var(--line);border-radius:12px;padding:1rem 1.1rem}
  .card .l{font-size:13px;color:var(--muted)} .card .v{font-size:27px;font-weight:600;color:var(--head);margin-top:2px} .card .b{font-size:12px;color:var(--faint);margin-top:2px}
  .legend{display:flex;flex-wrap:wrap;gap:16px;margin:8px 0 10px;font-size:12px;color:var(--muted);align-items:center}
  .sw{width:11px;height:11px;border-radius:3px;display:inline-block;margin-right:5px;vertical-align:middle}
  .wrap{position:relative;width:100%;height:300px;margin-bottom:1.5rem}
  .row{display:grid;grid-template-columns:3fr 2fr;gap:28px;align-items:start}
  .how{background:var(--surface);border:1px solid var(--line);border-radius:12px;padding:1.1rem 1.25rem;margin-top:1.5rem}
  .how p{margin:0 0 .6rem;font-size:14px;color:var(--text)} .how p:last-child{margin-bottom:0} .how b{color:var(--head);font-weight:600}
  code{font-family:ui-monospace,monospace;background:#222228;border:1px solid var(--line);border-radius:5px;padding:1px 5px;font-size:12px;color:#d6d6db}
  a{color:var(--teal)} footer{margin-top:2rem;font-size:12px;color:var(--faint);border-top:1px solid var(--line);padding-top:1rem}
  @media(max-width:560px){.row{grid-template-columns:1fr}}
</style></head><body>
<h1>Alkanes' share of Bitcoin OP_RETURN</h1>
<p class="sub">${data.span} · ${data.days} days · ${data.totalTx.toLocaleString('en-US')} transactions · updated daily</p>
<div class="cards">
  ${card('Latest day', latest)}
  ${card('Last 7 days', d7)}
  ${card('Last 30 days', d30)}
  ${card('All time', all)}
</div>
<h2>Daily Alkanes share</h2>
<div class="legend"><span><span class="sw" style="background:var(--teal)"></span>OP_RETURN bytes — 7-day avg</span><span><span class="sw" style="background:var(--purple)"></span>Transactions — 7-day avg</span><span><span class="sw" style="background:#4a4658"></span>Transactions — daily</span></div>
<div class="wrap"><canvas id="g"></canvas></div>
<div class="row">
  <div>
    <h2 style="margin-top:0">OP_RETURN bytes (all time)</h2>
    <div class="legend"><span><span class="sw" style="background:var(--teal)"></span>Alkanes</span><span><span class="sw" style="background:#3a3a42"></span>Everything else</span></div>
    <div class="wrap" style="height:210px"><canvas id="d"></canvas></div>
  </div>
  <div>
    <h2 style="margin-top:0">How it's calculated</h2>
    <div class="how">
      <p>We read every Bitcoin block in the window and inspect each transaction's outputs. An output whose script starts with <code>6a</code> is an <b>OP_RETURN</b>; one starting <code>6a5d</code> is a Runestone.</p>
      <p>We decode the Runestone and if any protostone carries <b>protocol_tag = 1</b>, the transaction is <b>Alkanes</b>.</p>
      <p><b>Share of transactions</b> = Alkanes tx ÷ all tx. <b>Share of OP_RETURN bytes</b> = Alkanes OP_RETURN bytes ÷ all OP_RETURN bytes (the data-volume view, steadier).</p>
      <p>Daily points come from a sample of each day's blocks, so thin days are noisy; the <b>7-day average</b> and the cards above aggregate many blocks and show the real trend. Classification reuses the open-source <a href="https://github.com/Vdto88/alkanes-opreturn-decoder">alkanes-opreturn-decoder</a>.</p>
    </div>
  </div>
</div>
<footer>Source data: <a href="./history.csv">history.csv</a> (one row per day). Bytes = full output script; coinbase included. Auto-updated daily from the alkanes-opreturn-scanner.</footer>
<script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js"></script>
<script>
const D=${JSON.stringify(data)};
Chart.defaults.color='#9a9aa3'; Chart.defaults.font.family='system-ui,sans-serif';
const pc=v=>v+'%', grid='rgba(255,255,255,0.07)';
new Chart(g,{type:'line',data:{labels:D.labels,datasets:[
 {label:'Transactions — daily',data:D.txDaily,borderColor:'transparent',backgroundColor:'rgba(157,148,232,0.45)',showLine:false,pointRadius:1.8},
 {label:'OP_RETURN bytes — 7-day avg',data:D.bytesRoll,borderColor:'#2DBE8E',fill:false,pointRadius:0,tension:.35,borderWidth:2.5},
 {label:'Transactions — 7-day avg',data:D.txRoll,borderColor:'#9d94e8',fill:false,pointRadius:0,tension:.35,borderWidth:2.5}]},
 options:{responsive:true,maintainAspectRatio:false,interaction:{mode:'index',intersect:false},plugins:{legend:{display:false},tooltip:{callbacks:{label:c=>c.dataset.label+': '+c.parsed.y+'%'}}},scales:{y:{min:0,max:100,grid:{color:grid},ticks:{callback:pc,stepSize:20}},x:{grid:{display:false},ticks:{maxRotation:45,autoSkip:true,maxTicksLimit:12}}}}});
new Chart(d,{type:'doughnut',data:{labels:['Alkanes','Everything else'],datasets:[{data:[D.donutAlk,+(100-D.donutAlk).toFixed(1)],backgroundColor:['#2DBE8E','#3a3a42'],borderWidth:0}]},options:{responsive:true,maintainAspectRatio:false,cutout:'64%',plugins:{legend:{display:false},tooltip:{callbacks:{label:c=>c.label+': '+c.parsed+'%'}}}}});
</script></body></html>`;

writeFileSync('report.html', html);
console.log(`report.html (dark): ${data.days} dias (${data.span}) · 7d tx=${r1(alkShareCount(d7))}% · 30d tx=${r1(alkShareCount(d30))}%`);
