import { readFileSync, readdirSync, writeFileSync } from 'node:fs';

// Lê o cache (./cache/<h>.json) que o scanner gravou e gera um report.html
// standalone (abre no navegador) com a série temporal de Alkanes. Offline:
// a data é aproximada da altura (~600s/bloco) a partir do bloco mais novo.

interface Block {
  height: number;
  aggregate: { totalTx: number; txWithOpReturn: number; txAlkanes: number; opReturnBytesTotal: number; alkanesBytesTotal: number };
}

const cacheDir = process.argv[2] ?? 'cache';
const files = readdirSync(cacheDir).filter((f) => f.endsWith('.json'));
if (files.length === 0) {
  console.error(`sem blocos em ${cacheDir}/ — rode o scanner primeiro (npm run scan -- ...)`);
  process.exit(1);
}
const blocks: Block[] = files.map((f) => JSON.parse(readFileSync(`${cacheDir}/${f}`, 'utf8')));
blocks.sort((a, b) => a.height - b.height);

const maxH = blocks[blocks.length - 1].height;
const now = Date.now();
const blockTime = (h: number) => now - (maxH - h) * 600_000; // ~10 min/bloco

const pad = (n: number) => String(n).padStart(2, '0');
const ddmm = (ms: number) => { const d = new Date(ms); return `${pad(d.getUTCDate())}/${pad(d.getUTCMonth() + 1)}`; };

// bins semanais (segunda-feira UTC)
type W = { totalTx: number; orTx: number; alkTx: number; orB: number; alkB: number; n: number };
const weekly = new Map<number, W>();
for (const b of blocks) {
  const ms = blockTime(b.height);
  const d = new Date(ms);
  const monday = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  const w = weekly.get(monday) ?? { totalTx: 0, orTx: 0, alkTx: 0, orB: 0, alkB: 0, n: 0 };
  const a = b.aggregate;
  w.totalTx += a.totalTx; w.orTx += a.txWithOpReturn; w.alkTx += a.txAlkanes;
  w.orB += a.opReturnBytesTotal; w.alkB += a.alkanesBytesTotal; w.n += 1;
  weekly.set(monday, w);
}
const weeks = [...weekly.entries()].sort((a, b) => a[0] - b[0]);
const r1 = (x: number) => +(x * 100).toFixed(2);
const labels = weeks.map(([ms]) => ddmm(ms));
const txAlk = weeks.map(([, w]) => r1(w.alkTx / w.totalTx));
const bytesAlk = weeks.map(([, w]) => r1(w.orB ? w.alkB / w.orB : 0));
const alk = txAlk;
const nonAlkOR = weeks.map(([, w]) => r1((w.orTx - w.alkTx) / w.totalTx));
const noOR = weeks.map(([, w]) => r1((w.totalTx - w.orTx) / w.totalTx));

const T = blocks.reduce((s, b) => {
  const a = b.aggregate;
  s.t += a.totalTx; s.o += a.txWithOpReturn; s.k += a.txAlkanes; s.ob += a.opReturnBytesTotal; s.kb += a.alkanesBytesTotal;
  return s;
}, { t: 0, o: 0, k: 0, ob: 0, kb: 0 });
const totalTxAlk = r1(T.k / T.t);
const totalBytesAlk = r1(T.kb / T.ob);
const donutAlk = totalBytesAlk;

const data = { labels, txAlk, bytesAlk, alk, nonAlkOR, noOR, donutAlk, totalTxAlk, totalBytesAlk, totalTx: T.t, nBlocks: blocks.length, span: `${ddmm(blockTime(blocks[0].height))}–${ddmm(blockTime(maxH))}` };

const html = `<!doctype html>
<html lang="pt-br"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Alkanes — OP_RETURN scanner</title>
<style>
  body{font-family:system-ui,-apple-system,sans-serif;max-width:860px;margin:2rem auto;padding:0 1rem;color:#1a1a1a}
  h1{font-weight:500;font-size:22px} h2{font-weight:500;font-size:16px;margin-top:2rem}
  .cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:12px;margin:1rem 0 1.5rem}
  .card{background:#f4f3ee;border-radius:8px;padding:1rem} .card .l{font-size:13px;color:#666} .card .v{font-size:24px;font-weight:500}
  .legend{display:flex;flex-wrap:wrap;gap:14px;margin:6px 0;font-size:12px;color:#666;align-items:center}
  .sw{width:10px;height:10px;border-radius:2px;display:inline-block;margin-right:4px;vertical-align:middle}
  .wrap{position:relative;width:100%;height:300px;margin-bottom:1.5rem}
  .row{display:grid;grid-template-columns:1fr 1fr;gap:24px}
  footer{margin-top:2rem;font-size:12px;color:#888;border-top:1px solid #eee;padding-top:1rem}
</style></head><body>
<h1>Alkanes — share de OP_RETURN no Bitcoin</h1>
<p>Janela: ${data.span} · ${data.nBlocks} blocos em cache · ${data.totalTx.toLocaleString('pt-br')} tx</p>
<div class="cards">
  <div class="card"><div class="l">tx = Alkanes</div><div class="v">${data.totalTxAlk}%</div></div>
  <div class="card"><div class="l">bytes de OP_RETURN = Alkanes</div><div class="v">${data.totalBytesAlk}%</div></div>
  <div class="card"><div class="l">blocos</div><div class="v">${data.nBlocks}</div></div>
</div>
<h2>Share de Alkanes por semana</h2>
<div class="legend"><span><span class="sw" style="background:#1D9E75"></span>bytes OP_RETURN = Alkanes</span><span><span class="sw" style="background:#534AB7"></span>tx = Alkanes</span><span><span class="sw" style="border-top:2px dashed #BA7517;width:14px;height:0"></span>Cuny 91%</span><span><span class="sw" style="border-top:2px dashed #888780;width:14px;height:0"></span>Dune 43,6%</span></div>
<div class="wrap"><canvas id="g"></canvas></div>
<div class="row">
  <div><h2>Bytes de OP_RETURN</h2><div class="legend"><span><span class="sw" style="background:#1D9E75"></span>Alkanes</span><span><span class="sw" style="background:#B4B2A9"></span>resto</span></div><div class="wrap" style="height:220px"><canvas id="d"></canvas></div></div>
  <div><h2>Composição das tx</h2><div class="legend"><span><span class="sw" style="background:#1D9E75"></span>Alkanes</span><span><span class="sw" style="background:#EF9F27"></span>OP_RET não-Alk</span><span><span class="sw" style="background:#B4B2A9"></span>sem OP_RET</span></div><div class="wrap" style="height:220px"><canvas id="s"></canvas></div></div>
</div>
<footer>Gerado por tools/build-report.ts a partir do cache local. Datas aproximadas (~10 min/bloco). bytes = scriptPubKey inteiro; denominador da métrica 2 = todos os OP_RETURN; coinbase incluída.</footer>
<script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js"></script>
<script>
const D=${JSON.stringify(data)};
const flat=v=>D.labels.map(()=>v), pc=v=>v+'%';
new Chart(g,{type:'line',data:{labels:D.labels,datasets:[
 {label:'bytes',data:D.bytesAlk,borderColor:'#1D9E75',pointStyle:'rect',pointRadius:3,tension:.3,borderWidth:2},
 {label:'tx',data:D.txAlk,borderColor:'#534AB7',pointStyle:'circle',pointRadius:3,tension:.3,borderWidth:2},
 {label:'Cuny',data:flat(91),borderColor:'#BA7517',borderDash:[5,4],pointRadius:0,borderWidth:1.5},
 {label:'Dune',data:flat(43.6),borderColor:'#888780',borderDash:[5,4],pointRadius:0,borderWidth:1.5}]},
 options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false}},scales:{y:{min:0,max:100,ticks:{callback:pc}},x:{ticks:{autoSkip:false,maxRotation:45}}}}});
new Chart(d,{type:'doughnut',data:{labels:['Alkanes','resto'],datasets:[{data:[D.donutAlk,+(100-D.donutAlk).toFixed(2)],backgroundColor:['#1D9E75','#B4B2A9'],borderWidth:0}]},options:{responsive:true,maintainAspectRatio:false,cutout:'62%',plugins:{legend:{display:false}}}});
new Chart(s,{type:'bar',data:{labels:D.labels,datasets:[
 {label:'Alkanes',data:D.alk,backgroundColor:'#1D9E75'},
 {label:'OP_RET não-Alk',data:D.nonAlkOR,backgroundColor:'#EF9F27'},
 {label:'sem OP_RET',data:D.noOR,backgroundColor:'#B4B2A9'}]},
 options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false}},scales:{x:{stacked:true,ticks:{autoSkip:false,maxRotation:45,font:{size:10}}},y:{stacked:true,min:0,max:100,ticks:{callback:pc}}}}});
</script></body></html>`;

writeFileSync('report.html', html);
console.log(`report.html gerado · ${data.nBlocks} blocos · ${data.span} · tx=Alkanes ${data.totalTxAlk}% · bytes ${data.totalBytesAlk}%`);
