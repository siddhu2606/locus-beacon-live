/* Headless test: (1) demo mode accuracy for 2/3/4 beacons, (2) live mode against a mock receiver phone that serves the dashboard and /api/samples exactly like the Android app does.
   node scripts/test_dashboard.js */
const http = require('http'), fs = require('fs'), path = require('path'), { launch } = require('./cdp.js');
let fail = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fail++; };
const page = fs.readFileSync(path.join(__dirname, '..', 'dashboard.html'));
/* mock phone: a person stands at TRUE; beacons at triangle positions for an 8x6 room */
const B = [[.3, .3], [7.7, .3], [4, 5.7]]; let TRUE = [2, 2], seq = 0, buf = [];
const gauss = () => Math.sqrt(-2 * Math.log(Math.random() + 1e-9)) * Math.cos(6.283 * Math.random());
setInterval(() => { B.forEach((b, i) => { if (i === 1 && global.KILL2) return; const d = Math.max(.3, Math.hypot(TRUE[0] - b[0], TRUE[1] - b[1])); buf.push([++seq, i + 1, Math.round(-59 - 22 * Math.log10(d) + 3 * gauss()), Date.now()]); }); if (buf.length > 3000) buf.shift(); }, 100);
const srv = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x'); res.setHeader('Access-Control-Allow-Origin', '*');
  if (u.pathname === '/api/samples') { const since = +u.searchParams.get('since') || 0, now = Date.now(); res.setHeader('Content-Type', 'application/json'); return res.end(JSON.stringify({ seq, device: 'MockPhone', samples: buf.filter(s => s[0] > since).map(s => [s[0], s[1], s[2], now - s[3]]) })); }
  res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.end(page);
}).listen(8090, '127.0.0.1');
(async () => {
  /* demo: file:// is not http so it starts in demo mode */
  const D = await launch('file:///' + path.join(__dirname, '..', 'dashboard.html').replace(/\\/g, '/'), 1100, 800); await D.sleep(500);
  const res = {};
  for (const k of [2, 3, 4, 6]) { await D.ev(`__lbl.layout(${k})`); await D.sleep(6000); await D.ev(`__lbl.S.log=[]`); await D.sleep(25000); res[k] = JSON.parse(await D.ev(`JSON.stringify({n:__lbl.S.log.length,e:__lbl.S.log.map(l=>l.err).sort((a,b)=>a-b)})`)); const e = res[k].e; console.log(`demo ${k} beacons: n=${e.length} median=${e[e.length >> 1].toFixed(2)} m, p95=${e[Math.floor(e.length * .95)].toFixed(2)} m`); }
  ok(res[3].e[res[3].e.length >> 1] < 2.5, 'demo, 3 beacons: median error under 2.5 m');
  ok(res[6].e[res[6].e.length >> 1] <= res[2].e[res[2].e.length >> 1] + 0.3, 'demo: 6 beacons not worse than 2');
  await D.shot(path.join(__dirname, '..', 'docs', 'shot_demo.png')); ok(!D.logs.length, 'no console errors (demo) ' + D.logs.join('|')); D.close();
  /* live against mock phone */
  const L = await launch('http://127.0.0.1:8090/', 1100, 800); await L.sleep(3500); console.log('live logs', L.logs, await L.ev('typeof __lbl + location.href'));
  ok(await L.ev(`__lbl.S.mode==='live' && __lbl.S.link`), 'served-by-phone page starts in live mode and links');
  ok(await L.ev(`__lbl.S.slots.slice(0,3).every(s=>s.n>0)`), 'all 3 beacons heard');
  await L.sleep(6000); let o = JSON.parse(await L.ev(`JSON.stringify(__lbl.S.out&&__lbl.S.out.pos)`)); const e1 = Math.hypot(o[0] - 2, o[1] - 2); console.log('live est at (2,2):', o.map(v => v.toFixed(2)).join(','), 'err', e1.toFixed(2)); ok(e1 < 2.0, 'live estimate within 2 m of the true spot');
  /* the person walks to (6,4); user clicks that spot on the map -> error logged */
  TRUE = [6, 4]; await L.sleep(8000); o = JSON.parse(await L.ev(`JSON.stringify(__lbl.S.out.pos)`)); const e2 = Math.hypot(o[0] - 6, o[1] - 4); console.log('live est at (6,4):', o.map(v => v.toFixed(2)).join(','), 'err', e2.toFixed(2)); ok(e2 < 2.0, 'live estimate follows to the new spot');
  await L.ev(`__lbl.logErr(__lbl.S.out.pos,[6,4],__lbl.S.out.ell)`); ok(+(await L.ev(`document.getElementById('s-n').textContent`)) === 1, 'truth click logged an error sample');
  /* lose beacon 2 : estimate must survive and beacon trust must drop */
  global.KILL2 = true; await L.sleep(7000); o = JSON.parse(await L.ev(`JSON.stringify(__lbl.S.out.pos)`)); const e3 = Math.hypot(o[0] - 6, o[1] - 4); console.log('beacon 2 dead, err', e3.toFixed(2)); ok(e3 < 3.0, 'estimate survives losing 1 of 3 beacons');
  ok(await L.ev(`__lbl.S.slots[1].n===0`), 'dead beacon shows no packets');
  await L.shot(path.join(__dirname, '..', 'docs', 'shot_live.png')); ok(!L.logs.length, 'no console errors (live) ' + L.logs.join('|')); L.close(); srv.close();
  console.log(fail ? fail + ' FAILED' : 'ALL PASSED'); process.exit(fail ? 1 : 0);
})();
