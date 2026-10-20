/* Headless test of the dashboard tools: weak/silent beacon warnings, movement trail, saved layouts, guided calibration.
   Uses the same mock receiver phone as test_dashboard.js.   node scripts/test_features.js */
const http = require('http'), fs = require('fs'), path = require('path'), { launch } = require('./cdp.js');
let fail = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fail++; };
const page = fs.readFileSync(path.join(__dirname, '..', 'dashboard.html'));
const B = [[.3, .3], [7.7, .3], [4, 5.7]]; let TRUE = [2, 2], seq = 0, buf = [], KILL2 = false, WEAK3 = false;
const gauss = () => Math.sqrt(-2 * Math.log(Math.random() + 1e-9)) * Math.cos(6.283 * Math.random());
setInterval(() => { B.forEach((b, i) => { if (i === 1 && KILL2) return; const d = Math.max(.3, Math.hypot(TRUE[0] - b[0], TRUE[1] - b[1])); buf.push([++seq, i + 1, Math.round(-59 - 22 * Math.log10(d) + 3 * gauss() - (i === 2 && WEAK3 ? 25 : 0)), Date.now()]); }); if (buf.length > 3000) buf.shift(); }, 100);
const srv = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  if (u.pathname === '/api/samples') { const since = +u.searchParams.get('since') || 0, now = Date.now(); res.setHeader('Content-Type', 'application/json'); return res.end(JSON.stringify({ seq, device: 'MockPhone', samples: buf.filter(s => s[0] > since).map(s => [s[0], s[1], s[2], now - s[3]]) })); }
  res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.end(page);
}).listen(8091, '127.0.0.1');
(async () => {
  const L = await launch('http://127.0.0.1:8091/', 1200, 1100); await L.sleep(4000);
  const txt = id => L.ev(`document.getElementById('${id}').textContent`);
  /* health */
  ok(/healthy/.test(await txt('warn')), 'banner says all healthy at start: ' + await txt('warn'));
  KILL2 = true; await L.sleep(4500);
  ok(await L.ev(`document.getElementById('warn').className.includes('bad') && /Beacon 2: no packets/.test(document.getElementById('warn').textContent)`), 'silent beacon 2 raises a red warning');
  ok(await L.ev(`document.querySelectorAll('.c-s')[1].className.includes('bad')`), 'beacon 2 dot is red');
  ok(await L.ev(`/Only 2 of 3/.test(document.getElementById('warn').textContent)`), 'warns that only 2 of 3 beacons are heard');
  KILL2 = false; WEAK3 = true; await L.sleep(5000);
  ok(await L.ev(`/Beacon 3: weak signal/.test(document.getElementById('warn').textContent) || /Beacon 3/.test(document.getElementById('warn').textContent)`), 'weak beacon 3 is flagged: ' + (await txt('warn')).slice(0, 90));
  WEAK3 = false; await L.sleep(5000);
  ok(/healthy/.test(await txt('warn')), 'warning clears once beacons recover');
  await L.ev(`__lbl.applyLayout({W:8,H:6,n:2.2,p1:-59,slots:[{on:true,x:1,y:1},{on:true,x:4,y:1},{on:true,x:7,y:1}]})`); await L.sleep(4500);
  ok(await L.ev(`/almost in a line/.test(document.getElementById('warn').textContent)`), 'three beacons in a line trigger the geometry warning');
  /* trail */
  await L.ev(`__lbl.applyLayout({W:8,H:6,n:2.2,p1:-59,slots:[{on:true,x:.3,y:.3},{on:true,x:7.7,y:.3},{on:true,x:4,y:5.7}]})`); await L.sleep(3000);
  TRUE = [6, 4]; await L.sleep(9000);
  ok(await L.ev(`__lbl.S.trail.length>5`), 'trail has points');
  ok(await L.ev(`__lbl.S.path>1`), 'path length accumulates: ' + await txt('n-path'));
  await L.ev(`(function(){var s=document.getElementById('i-tl');s.value=5;s.oninput()})()`);
  ok(await L.ev(`__lbl.S.trailMax===20 && __lbl.S.trail.length<=20`), 'trail length slider trims the trail');
  await L.ev(`document.getElementById('b-tclr').click()`); ok(await L.ev(`__lbl.S.trail.length===0 && __lbl.S.path===0`), 'clear trail resets path');
  await L.ev(`document.getElementById('b-trail').click()`); ok(await L.ev(`__lbl.S.showTrail===false`), 'trail can be switched off');
  /* layouts */
  await L.ev(`(function(){__lbl.S.slots[0].x=1.5;document.getElementById('l-name').value='Lab A';document.getElementById('l-save').click()})()`);
  ok(await L.ev(`document.getElementById('l-sel').options.length===1 && document.getElementById('l-sel').value==='Lab A'`), 'layout saved and listed');
  await L.ev(`(function(){var i=document.getElementById('i-W');i.value=12;i.onchange()})()`); ok(await L.ev(`__lbl.S.W===12`), 'room resized to 12 m');
  await L.ev(`document.getElementById('l-load').click()`); ok(await L.ev(`__lbl.S.W===8 && Math.abs(__lbl.S.slots[0].x-1.5)<.01 && document.getElementById('i-W').value==='8'`), 'loading restores room size, beacon position and inputs');
  ok(await L.ev(`(function(){try{__lbl.applyLayout({bad:1});return false}catch(e){return true}})()`), 'bad layout file is rejected');
  ok(await L.ev(`JSON.parse(localStorage.getItem('lbl_last')).slots.length===6`), 'current setup autosaved for next visit');
  await L.ev(`document.getElementById('l-del').click()`); ok(await L.ev(`document.getElementById('l-sel').value===''`), 'layout deleted');
  /* guided calibration */
  await L.ev(`document.getElementById('b-gcal').click()`); ok(await L.ev(`document.getElementById('gcal').style.display==='block' && /Beacon 1/.test(document.getElementById('g-title').textContent)`), 'guided calibration opens on beacon 1');
  await L.ev(`document.getElementById('g-go').click()`); await L.sleep(4800);
  ok(await L.ev(`__lbl.S.slots[0].p1!==null && /Saved/.test(document.getElementById('g-text').textContent + document.getElementById('g-title').textContent) || /Beacon 2/.test(document.getElementById('g-title').textContent)`), 'beacon 1 calibrated: ' + await L.ev(`__lbl.S.slots[0].p1`));
  await L.sleep(1500); ok(await L.ev(`/Beacon 2/.test(document.getElementById('g-title').textContent)`), 'wizard moves to beacon 2');
  await L.ev(`document.getElementById('g-stop').click()`); ok(await L.ev(`document.getElementById('gcal').style.display==='none'`), 'wizard can be stopped');
  await L.ev(`document.querySelectorAll('.cal')[2].click()`); await L.sleep(3600); ok(await L.ev(`__lbl.S.slots[2].p1!==null`), 'single 1 m button still works and shows progress');
  await L.shot(path.join(__dirname, '..', 'docs', 'shot_features.png'));
  ok(!L.logs.length, 'no console errors ' + L.logs.join('|')); L.close(); srv.close();
  console.log(fail ? fail + ' FAILED' : 'ALL PASSED'); process.exit(fail ? 1 : 0);
})();
