import { readFileSync, readdirSync, writeFileSync } from 'node:fs';

// Reads the cache (./cache/<h>.json) the scanner wrote and generates a
// standalone report.html (open in a browser) with the Alkanes time series.
// Offline: dates are approximated from height (~600s/block) anchored on the
// newest cached block.

interface Block {
  height: number;
  aggregate: { totalTx: number; txWithOpReturn: number; txAlkanes: number; opReturnBytesTotal: number; alkanesBytesTotal: number };
}

const cacheDir = process.argv[2] ?? 'cache';
const files = readdirSync(cacheDir).filter((f) => f.endsWith('.json'));
if (files.length === 0) {
  console.error(`no blocks in ${cacheDir}/ — run the scanner first (npm run scan -- ...)`);
  process.exit(1);
}
const blocks: Block[] = files.map((f) => JSON.parse(readFileSync(`${cacheDir}/${f}`, 'utf8')));
blocks.sort((a, b) => a.height - b.height);

const maxH = blocks[blocks.length - 1].height;
const now = Date.now();
const blockTime = (h: number) => now - (maxH - h) * 600_000; // ~10 min/block

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const mday = (ms: number) => { const d = new Date(ms); return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`; };

// weekly bins (Monday UTC)
type W = { totalTx: number; orTx: number; alkTx: number; orB: number; alkB: number; n: number };
const weekly = new Map<number, W>();
for (const b of blocks) {
  const d = new Date(blockTime(b.height));
  const monday = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  const w = weekly.get(monday) ?? { totalTx: 0, orTx: 0, alkTx: 0, orB: 0, alkB: 0, n: 0 };
  const a = b.aggregate;
  w.totalTx += a.totalTx; w.orTx += a.txWithOpReturn; w.alkTx += a.txAlkanes;
  w.orB += a.opReturnBytesTotal; w.alkB += a.alkanesBytesTotal; w.n += 1;
  weekly.set(monday, w);
}
const weeks = [...weekly.entries()].sort((a, b) => a[0] - b[0]);
const r1 = (x: number) => +(x * 100).toFixed(2);
const labels = weeks.map(([ms]) => mday(ms));
const txAlk = weeks.map(([, w]) => r1(w.alkTx / w.totalTx));
const bytesAlk = weeks.map(([, w]) => r1(w.orB ? w.alkB / w.orB : 0));
const nonAlkOR = weeks.map(([, w]) => r1((w.orTx - w.alkTx) / w.totalTx));
const noOR = weeks.map(([, w]) => r1((w.totalTx - w.orTx) / w.totalTx));

const T = blocks.reduce((s, b) => {
  const a = b.aggregate;
  s.t += a.totalTx; s.o += a.txWithOpReturn; s.k += a.txAlkanes; s.ob += a.opReturnBytesTotal; s.kb += a.alkanesBytesTotal;
  return s;
}, { t: 0, o: 0, k: 0, ob: 0, kb: 0 });

const data = {
  labels, txAlk, bytesAlk, nonAlkOR, noOR,
  totalTxAlk: r1(T.k / T.t), totalBytesAlk: r1(T.kb / T.ob),
  donutAlk: r1(T.kb / T.ob), totalTx: T.t, nBlocks: blocks.length,
  span: `${mday(blockTime(blocks[0].height))} – ${mday(blockTime(maxH))}`,
};

const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Alkanes — OP_RETURN scanner</title>
<style>
  body{font-family:system-ui,-apple-system,sans-serif;max-width:880px;margin:2rem auto;padding:0 1rem;color:#1a1a1a}
  h1{font-weight:500;font-size:22px;margin-bottom:2px} h2{font-weight:500;font-size:16px;margin:2rem 0 2px}
  .sub{color:#777;font-size:13px;margin:0 0 1.25rem}
  .cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:12px;margin:1rem 0 1.75rem}
  .card{background:#f4f3ee;border-radius:8px;padding:1rem} .card .l{font-size:13px;color:#666} .card .v{font-size:26px;font-weight:500}
  .legend{display:flex;flex-wrap:wrap;gap:16px;margin:8px 0 10px;font-size:12px;color:#666;align-items:center}
  .sw{width:11px;height:11px;border-radius:3px;display:inline-block;margin-right:5px;vertical-align:middle}
  .wrap{position:relative;width:100%;height:300px;margin-bottom:1.75rem}
  .row{display:grid;grid-template-columns:1fr 1fr;gap:24px}
  footer{margin-top:2rem;font-size:12px;color:#888;border-top:1px solid #eee;padding-top:1rem;line-height:1.6}
</style></head><body>
<h1>Alkanes share of Bitcoin OP_RETURN</h1>
<p class="sub">${data.span} · ${data.nBlocks} cached blocks · ${data.totalTx.toLocaleString('en-US')} transactions</p>
<div class="cards">
  <div class="card"><div class="l">Transactions that are Alkanes</div><div class="v">${data.totalTxAlk}%</div></div>
  <div class="card"><div class="l">OP_RETURN bytes that are Alkanes</div><div class="v">${data.totalBytesAlk}%</div></div>
  <div class="card"><div class="l">Cached blocks</div><div class="v">${data.nBlocks}</div></div>
</div>
<h2>Alkanes share of Bitcoin, by week</h2>
<div class="legend"><span><span class="sw" style="background:#1D9E75"></span>Share of OP_RETURN bytes</span><span><span class="sw" style="background:#534AB7"></span>Share of transactions</span></div>
<div class="wrap"><canvas id="g"></canvas></div>
<div class="row">
  <div><h2>OP_RETURN bytes</h2><div class="legend"><span><span class="sw" style="background:#1D9E75"></span>Alkanes</span><span><span class="sw" style="background:#B4B2A9"></span>Everything else</span></div><div class="wrap" style="height:220px"><canvas id="d"></canvas></div></div>
  <div><h2>Transaction mix, by week</h2><div class="legend"><span><span class="sw" style="background:#1D9E75"></span>Alkanes</span><span><span class="sw" style="background:#EF9F27"></span>Other OP_RETURN</span><span><span class="sw" style="background:#B4B2A9"></span>No OP_RETURN</span></div><div class="wrap" style="height:220px"><canvas id="s"></canvas></div></div>
</div>
<footer>Generated by tools/build-report.ts from the local cache. Dates approximated (~10 min/block). Bytes = full scriptPubKey; metric 2 denominator = all OP_RETURN; coinbase included. Classification via the v1 decoder (decodeOpReturn, protocol_tag = 1).</footer>
<script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js"></script>
<script>
const D=${JSON.stringify(data)};
const pc=v=>v+'%', grid='rgba(120,120,120,0.12)';
new Chart(g,{type:'line',data:{labels:D.labels,datasets:[
 {label:'Share of OP_RETURN bytes',data:D.bytesAlk,borderColor:'#1D9E75',backgroundColor:'rgba(29,158,117,0.10)',fill:true,pointStyle:'rect',pointRadius:3,tension:.35,borderWidth:2.5},
 {label:'Share of transactions',data:D.txAlk,borderColor:'#534AB7',fill:false,pointStyle:'circle',pointRadius:3,tension:.35,borderWidth:2.5}]},
 options:{responsive:true,maintainAspectRatio:false,interaction:{mode:'index',intersect:false},plugins:{legend:{display:false},tooltip:{callbacks:{label:c=>c.dataset.label+': '+c.parsed.y+'%'}}},scales:{y:{min:0,max:100,grid:{color:grid},ticks:{callback:pc,stepSize:20}},x:{grid:{display:false},ticks:{autoSkip:false,maxRotation:45}}}}});
new Chart(d,{type:'doughnut',data:{labels:['Alkanes','Everything else'],datasets:[{data:[D.donutAlk,+(100-D.donutAlk).toFixed(2)],backgroundColor:['#1D9E75','#B4B2A9'],borderWidth:0}]},options:{responsive:true,maintainAspectRatio:false,cutout:'64%',plugins:{legend:{display:false},tooltip:{callbacks:{label:c=>c.label+': '+c.parsed+'%'}}}}});
new Chart(s,{type:'bar',data:{labels:D.labels,datasets:[
 {label:'Alkanes',data:D.txAlk,backgroundColor:'#1D9E75'},
 {label:'Other OP_RETURN',data:D.nonAlkOR,backgroundColor:'#EF9F27'},
 {label:'No OP_RETURN',data:D.noOR,backgroundColor:'#B4B2A9'}]},
 options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false},tooltip:{callbacks:{label:c=>c.dataset.label+': '+c.parsed.y.toFixed(1)+'%'}}},scales:{x:{stacked:true,grid:{display:false},ticks:{autoSkip:false,maxRotation:45,font:{size:10}}},y:{stacked:true,min:0,max:100,grid:{color:grid},ticks:{callback:pc,stepSize:25}}}}});
</script></body></html>`;

writeFileSync('report.html', html);
console.log(`report.html generated · ${data.nBlocks} blocks · ${data.span} · tx=Alkanes ${data.totalTxAlk}% · bytes ${data.totalBytesAlk}%`);
