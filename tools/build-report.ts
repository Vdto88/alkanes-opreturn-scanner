import { writeFileSync } from 'node:fs';
import {
  readHistory, rollup, alkShareCount, alkBytesShare, opReturnShare, dieselShareCount, runesBytesShare, otherBytesShare,
  alkExDieselShareCount,
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

const r1 = (x: number) => +(x * 100).toFixed(1);
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const mday = (iso: string) => { const [, m, d] = iso.split('-'); return `${MONTHS[+m - 1]} ${+d}`; };

const sumsOfRow = (r: HistoryRow): Sums => ({
  blocksScanned: r.blocksScanned, totalTx: r.totalTx, txWithOpReturn: r.txWithOpReturn,
  txAlkanes: r.txAlkanes, opReturnBytes: r.opReturnBytes, runestoneBytes: r.runestoneBytes, alkanesBytes: r.alkanesBytes, dieselMints: r.dieselMints,
});

const all = rollup(rows, '0000-00-00');
const latest = sumsOfRow(rows[rows.length - 1]);
const d7 = rollup(rows, utcDate(-6));
const d30 = rollup(rows, utcDate(-29));

const card = (label: string, s: Sums) =>
  `<div class="card"><div class="l">${label}</div><div class="v">${r1(alkShareCount(s))}%</div><div class="u">Alkanes — of all BTC tx</div><div class="b">${r1(alkBytesShare(s))}% of OP_RETURN bytes</div></div>`;

// DIESEL como % das tx Alkanes (mostra que Alkanes ≈ DIESEL) no período inteiro
const dieselOfAlkanes = all.txAlkanes ? r1(all.dieselMints / all.txAlkanes) : 0;
// estimativa de mints/dia no full-day (extrapola a amostra: mints/blocosAmostrados × ~144)
const estDieselPerDay = Math.round((d30.dieselMints / Math.max(1, d30.blocksScanned)) * 144);

// composição dos bytes de OP_RETURN (all time): Alkanes / Runes / Other
const donutAlk = r1(alkBytesShare(all));
const donutRunes = r1(runesBytesShare(all));
const donutOther = r1(otherBytesShare(all));

const data = {
  labels: rows.map((r) => mday(r.date)),
  txDaily: rows.map((r) => r1(alkShareCount(sumsOfRow(r)))),
  bytesDaily: rows.map((r) => r1(alkBytesShare(sumsOfRow(r)))),
  dieselDaily: rows.map((r) => r1(dieselShareCount(sumsOfRow(r)))),
  opReturnDaily: rows.map((r) => r1(opReturnShare(sumsOfRow(r)))),
  runesDaily: rows.map((r) => r1(runesBytesShare(sumsOfRow(r)))),
  alkExDieselDaily: rows.map((r) => r1(alkExDieselShareCount(sumsOfRow(r)))),
  donut: [donutAlk, donutRunes, donutOther],
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
  .sw{width:11px;height:11px;border-radius:3px;display:inline-block;margin-right:5px;vertical-align:middle}
  .wrap{position:relative;width:100%;height:300px;margin-bottom:1.5rem}
  .how{background:var(--surface);border:1px solid var(--line);border-radius:12px;padding:1.1rem 1.25rem;margin-top:.5rem}
  .how p{margin:0 0 .6rem;font-size:14px;color:var(--text)} .how p:last-child{margin-bottom:0} .how b{color:var(--head);font-weight:600}
  code{font-family:ui-monospace,monospace;background:#222228;border:1px solid var(--line);border-radius:5px;padding:1px 5px;font-size:12px;color:#d6d6db}
  a{color:var(--teal)} footer{margin-top:2rem;font-size:12px;color:var(--faint);border-top:1px solid var(--line);padding-top:1rem}
</style></head><body>
<h1>Alkanes' share of Bitcoin OP_RETURN</h1>
<p class="sub">${data.span} · ${data.days} days · ${data.totalTx.toLocaleString('en-US')} transactions sampled · updated daily</p>
<div class="cards">
  ${card('Latest day', latest)}
  ${card('Last 7 days', d7)}
  ${card('Last 30 days', d30)}
  ${card('All time', all)}
  <div class="card"><div class="l">OP_RETURN penetration</div><div class="v">${r1(opReturnShare(all))}%</div><div class="u">of all BTC tx (carry OP_RETURN)</div><div class="b">${r1(opReturnShare(d30))}% last 30 days</div></div>
</div>
<p class="note">Numbers you may see elsewhere can differ — they depend on the time window and whether they measure transactions vs bytes vs outputs (and whether the coinbase is included).</p>
<p class="note">Of all Alkanes activity, <b>${dieselOfAlkanes}%</b> is DIESEL minting (cellpack <code>2:0</code> op&nbsp;77) — roughly <b>${estDieselPerDay.toLocaleString('en-US')}</b> mints/day estimated over the last 30 days.</p>

<h2>Daily Alkanes share</h2>
<div class="legend"><span><span class="sw" style="background:var(--teal)"></span>OP_RETURN bytes</span><span><span class="sw" style="background:var(--purple)"></span>Transactions</span><span><span class="sw" style="background:var(--faint)"></span>OP_RETURN penetration</span><span><span class="sw" style="background:var(--amber)"></span>Runes (bytes)</span><span><span class="sw" style="background:#4bb8d9"></span>Alkanes excl. DIESEL (tx)</span></div>
<div class="legend" style="margin-bottom:6px">
  <label><input type="checkbox" id="tgPen" checked> OP_RETURN penetration</label>
  <label><input type="checkbox" id="tgRunes" checked> Runes</label>
  <label><input type="checkbox" id="tgAlkEx" checked> Alkanes excl. DIESEL</label>
</div>
<div class="wrap"><canvas id="g"></canvas></div>

<h2>DIESEL mints — share of all Bitcoin transactions</h2>
<div class="legend"><span><span class="sw" style="background:var(--amber)"></span>DIESEL mints (% of all tx)</span></div>
<div class="wrap" style="height:240px"><canvas id="m"></canvas></div>

<h2>OP_RETURN bytes (all time)</h2>
<div class="legend"><span><span class="sw" style="background:var(--teal)"></span>Alkanes ${donutAlk}%</span><span><span class="sw" style="background:var(--amber)"></span>Runes ${donutRunes}%</span><span><span class="sw" style="background:#4a4a52"></span>Other ${donutOther}%</span></div>
<div class="wrap" style="height:230px;max-width:360px"><canvas id="d"></canvas></div>

<h2>How it's calculated</h2>
<div class="how">
  <p>We read every Bitcoin block in the window and inspect each transaction's outputs. An output whose script starts with <code>6a</code> is an <b>OP_RETURN</b>; one starting <code>6a5d</code> is a Runestone.</p>
  <p>We decode the Runestone and if any protostone carries <b>protocol_tag = 1</b>, the transaction is <b>Alkanes</b>. A <b>DIESEL mint</b> is the specific case where the cellpack targets <code>2:0</code> with opcode <code>77</code> (the genesis alkane) — today that's the vast majority of all Alkanes activity.</p>
  <p><b>Share of transactions</b> = matching tx ÷ all tx. <b>Share of OP_RETURN bytes</b> = Alkanes OP_RETURN bytes ÷ all OP_RETURN bytes. Shares are unaffected by sampling; each day rests on ~24-48 sampled blocks (see <code>blocksScanned</code> in the CSV). Classification reuses the open-source <a href="https://github.com/Vdto88/alkanes-opreturn-decoder">alkanes-opreturn-decoder</a>.</p>
  <p><b>Glossary.</b> <b>OP_RETURN penetration</b>: share of all BTC tx that carry an OP_RETURN. <b>Alkanes (tx)</b>: share of all BTC tx that are Alkanes. <b>Alkanes (bytes)</b>: share of OP_RETURN bytes that are Alkanes. <b>Runes</b>: OP_RETURN bytes that are Runestones but not Alkanes. <b>Alkanes excl. DIESEL</b>: Alkanes tx that aren't DIESEL mints — "real app" usage. <b>DIESEL</b>: mint of the genesis alkane (cellpack <code>2:0</code> op&nbsp;77).</p>
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
[['tgPen',2],['tgRunes',3],['tgAlkEx',4]].forEach(([id,idx])=>{const el=document.getElementById(id);el.addEventListener('change',()=>{gChart.setDatasetVisibility(idx,el.checked);gChart.update();});});
new Chart(m,{type:'line',data:{labels:D.labels,datasets:[
 {label:'DIESEL mints',data:D.dieselDaily,borderColor:'#E9A23B',backgroundColor:'rgba(233,162,59,0.12)',fill:true,pointRadius:1.5,tension:.25,borderWidth:2}]},
 options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false},tooltip:{callbacks:{label:c=>c.parsed.y+'% of all tx'}}},scales:{y:{min:0,max:100,grid:{color:grid},ticks:{callback:pc,stepSize:20}},x:{grid:{display:false},ticks:{maxRotation:45,autoSkip:true,maxTicksLimit:12}}}}});
new Chart(d,{type:'doughnut',data:{labels:['Alkanes','Runes','Other'],datasets:[{data:D.donut,backgroundColor:['#2DBE8E','#E9A23B','#4a4a52'],borderWidth:0}]},options:{responsive:true,maintainAspectRatio:false,cutout:'62%',plugins:{legend:{display:false},tooltip:{callbacks:{label:c=>c.label+': '+c.parsed+'%'}}}}});
</script></body></html>`;

writeFileSync('report.html', html);
console.log(`report.html: ${data.days} dias (${data.span}) · 30d tx=${r1(alkShareCount(d30))}% · DIESEL=${dieselOfAlkanes}% das Alkanes · ~${estDieselPerDay}/dia`);
