/* LOCUS Beacon dashboard. Raw BLE RSSI (from the receiver phone, or the built-in simulator) -> range -> LOCUS particle filter. Runs fully in the browser, no internet. */
(function () {
  const $ = id => document.getElementById(id);
  const LS = (k, v) => { try { if (v === undefined) return JSON.parse(localStorage.getItem('lbl_' + k)); localStorage.setItem('lbl_' + k, JSON.stringify(v)); } catch (e) { } return null; };
  const phoneServed = location.protocol === 'http:' && !/github\.io$/.test(location.hostname) && !!location.host && location.search.indexOf('demo') < 0;
  const S = { W: 8, H: 6, n: 2.2, p1: -59, sig: 4, mode: 'demo', slots: [], samples: [], seq: 0, trail: [], log: [], truth: null, locus: null, out: null, k: 3, link: false };
  const LAYOUT = {
    2: (W, H) => [[.3, .3], [W - .3, .3]], 3: (W, H) => [[.3, .3], [W - .3, .3], [W / 2, H - .3]],
    4: (W, H) => [[.3, .3], [W - .3, .3], [W - .3, H - .3], [.3, H - .3]], 6: (W, H) => [[.3, .3], [W / 2, .3], [W - .3, .3], [W - .3, H - .3], [W / 2, H - .3], [.3, H - .3]]
  };
  function layout(k) {
    const pts = LAYOUT[k](S.W, S.H); const keep = S.slots.map(s => s && s.p1);
    S.slots = Array.from({ length: 6 }, (_, i) => ({ on: i < k, x: pts[i] ? pts[i][0] : S.W / 2, y: pts[i] ? pts[i][1] : S.H / 2, p1: keep[i] != null ? keep[i] : LS('p1_' + (i + 1)), rssi: null, r: null, trust: null, why: '', n: 0 }));
    S.k = k; document.querySelectorAll('[data-lay]').forEach(b => b.classList.toggle('on', +b.dataset.lay === k)); buildTable(); rebuild();
  }
  function active() { return S.slots.map((s, i) => ({ s, i })).filter(o => o.s.on); }
  function rebuild() {
    const act = active(); setRoom(S.W, S.H, act.map(o => ({ id: 'B' + (o.i + 1), x: o.s.x, y: o.s.y })), []);
    S.locus = act.length ? new Locus(ANCHORS, { sigma: 1.0, N: 600, rng: rngMake(11) }) : null; S.out = null; S.trail = [];
  }
  function buildTable() {
    const tb = document.querySelector('#tb tbody'); tb.innerHTML = '';
    S.slots.forEach((s, i) => {
      const tr = document.createElement('tr');
      tr.innerHTML = '<td><b>' + (i + 1) + '</b></td><td><input type="checkbox"' + (s.on ? ' checked' : '') + '></td><td><input type="number" step="0.1" value="' + s.x.toFixed(1) + '"></td><td><input type="number" step="0.1" value="' + s.y.toFixed(1) + '"></td><td class="c-r">–</td><td class="c-d">–</td><td class="c-t"><div class="bar"><i style="width:0"></i></div></td><td><button class="cal" style="padding:2px 8px;font-size:12px">' + (s.p1 != null ? s.p1 + ' dBm' : '1 m') + '</button></td>';
      const ins = tr.querySelectorAll('input');
      ins[0].onchange = () => { s.on = ins[0].checked; rebuild(); }; ins[1].onchange = () => { s.x = +ins[1].value; rebuild(); }; ins[2].onchange = () => { s.y = +ins[2].value; rebuild(); };
      tr.querySelector('.cal').onclick = () => calibrate(i); tb.appendChild(tr);
    });
  }
  function calibrate(i) {
    const btn = document.querySelectorAll('.cal')[i]; btn.textContent = '…'; btn.disabled = true; const t0 = performance.now(), rs = [];
    const tm = setInterval(() => { const now = performance.now(); S.samples.filter(m => m.id === i + 1 && m.t > now - 300).forEach(m => rs.push(m.rssi)); }, 250);
    setTimeout(() => {
      clearInterval(tm); btn.disabled = false;
      if (rs.length < 4) { btn.textContent = 'no data'; setTimeout(() => btn.textContent = S.slots[i].p1 != null ? S.slots[i].p1 + ' dBm' : '1 m', 1500); return; }
      rs.sort((a, b) => a - b); S.slots[i].p1 = rs[rs.length >> 1]; LS('p1_' + (i + 1), S.slots[i].p1); btn.textContent = S.slots[i].p1 + ' dBm';
    }, 3000);
  }
  /* ---------- sources ---------- */
  const demo = { pos: [4, 3], tgt: [2, 2], body: [0, 0, 0, 0, 0, 0] };
  function demoTick(dt) {
    const d = Math.hypot(demo.tgt[0] - demo.pos[0], demo.tgt[1] - demo.pos[1]);
    if (d < 0.4) demo.tgt = [0.6 + Math.random() * (S.W - 1.2), 0.6 + Math.random() * (S.H - 1.2)];
    else { const st = Math.min(d, 0.9 * dt); demo.pos[0] += (demo.tgt[0] - demo.pos[0]) / d * st; demo.pos[1] += (demo.tgt[1] - demo.pos[1]) / d * st; }
    const now = performance.now();
    demo.acc = (demo.acc || 0) + dt * 12; const nS = Math.floor(demo.acc); demo.acc -= nS;
    S.slots.forEach((s, i) => {
      if (!s.on) return;
      if (demo.body[i] > 0) demo.body[i] -= dt; else if (Math.random() < 0.012 * dt) demo.body[i] = 4;   /* body block: -8 dB for ~4 s, roughly every 80 s per beacon */
      for (let k = 0; k < nS; k++) {
        if (Math.random() < 0.08) continue;
        const g = Math.sqrt(-2 * Math.log(Math.random() + 1e-9)) * Math.cos(6.283 * Math.random()), dist = Math.max(0.3, Math.hypot(demo.pos[0] - s.x, demo.pos[1] - s.y));
        S.samples.push({ id: i + 1, rssi: Math.round(-59 - 22 * Math.log10(dist) + S.sig * g - (demo.body[i] > 0 ? 8 : 0)), t: now - Math.random() * dt * 1000 });
      }
    });
    S.truth = demo.pos.slice();
  }
  let poll = null;
  function setPill(t, c) { $('pill').className = 'pill ' + (c || ''); $('pill-t').textContent = t; }
  function startLive() {
    const h = $('i-host').value.trim().replace(/^https?:\/\//, '').replace(/\/.*$/, ''), base = h ? 'http://' + h : ''; LS('host', h);
    if (poll) clearInterval(poll); S.seq = 0; S.link = false; setPill('Connecting…', 'warn'); let fails = 0, busy = false;
    poll = setInterval(async () => {
      if (busy) return; busy = true;
      try {
        const ac = new AbortController(), to = setTimeout(() => ac.abort(), 1500), r = await fetch(base + '/api/samples?since=' + S.seq, { signal: ac.signal, cache: 'no-store' }); clearTimeout(to);
        const j = await r.json(); fails = 0; if (j.seq < S.seq) S.seq = 0; const now = performance.now();
        (j.samples || []).forEach(a => S.samples.push({ id: a[1], rssi: a[2], t: now - a[3] })); S.seq = j.seq; S.link = true;
        setPill('Receiver connected · ' + (j.samples || []).length + ' packets', 'ok'); $('n-live').textContent = 'Linked to ' + (j.device || 'receiver') + '. Packets are real Bluetooth advertisements.';
      } catch (e) { if (++fails > 3) { S.link = false; setPill('No link to phone', 'warn'); } }
      busy = false;
    }, 250);
  }
  function setMode(m) {
    S.mode = m; $('b-demo').classList.toggle('on', m === 'demo'); $('b-live').classList.toggle('on', m === 'live'); $('live-box').style.display = m === 'live' ? 'block' : 'none';
    if (poll && m === 'demo') { clearInterval(poll); poll = null; } S.samples = []; S.truth = null; S.trail = [];
    if (m === 'demo') setPill('Demo · simulated Bluetooth', 'ok'); else { setPill('Not connected', 'warn'); if ($('i-host').value || phoneServed) startLive(); }
    $('n-map').textContent = m === 'demo' ? 'Demo: the green dot is the estimate, the blue ring is the simulated true position.' : 'Click the map where you are really standing to log an error sample.';
  }
  /* ---------- estimation loop ---------- */
  function estimate() {
    const now = performance.now(); S.samples = S.samples.filter(m => m.t > now - 6000); const act = active(); if (!act.length || !S.locus) return;
    const maxR = Math.hypot(S.W, S.H) * 1.2;
    const meas = act.map(o => {
      const v = S.samples.filter(m => m.id === o.i + 1 && m.t > now - 900).map(m => m.rssi).sort((a, b) => a - b); o.s.n = v.length;
      if (!v.length) { o.s.rssi = null; o.s.r = null; return null; }
      const med = v[v.length >> 1]; o.s.rssi = med; const p1 = o.s.p1 != null ? o.s.p1 : S.p1, r = Math.min(maxR, Math.max(0.3, Math.pow(10, (p1 - med) / (10 * S.n)))); o.s.r = r; return { r, s: r * 0.2303 * 3.0 / S.n };
    });
    const out = S.locus.step(meas, 0.25); S.out = out; if (!out) return;
    act.forEach((o, j) => { o.s.trust = out.trust[j]; o.s.why = out.reasons[j] || ''; });
    S.trail.push(out.pos.slice()); if (S.trail.length > 60) S.trail.shift();
    if (S.mode === 'demo' && S.truth) logErr(out.pos, S.truth, out.ell);
  }
  function logErr(pos, tr, ell) {
    const e = Math.hypot(pos[0] - tr[0], pos[1] - tr[1]), dx = tr[0] - pos[0], dy = tr[1] - pos[1], c = Math.cos(ell.th), s = Math.sin(ell.th), u = (dx * c + dy * s) / ell.a, v = (-dx * s + dy * c) / ell.b;
    S.log.push({ t: Date.now(), x: pos[0], y: pos[1], tx: tr[0], ty: tr[1], err: e, inside: u * u + v * v <= 1 ? 1 : 0, beacons: active().length }); if (S.log.length > 5000) S.log.shift();
    $('k-err').textContent = e.toFixed(2) + ' m'; stats();
  }
  const pct = (a, p) => { const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };
  function stats() {
    const L = S.log; $('s-n').textContent = L.length;
    if (!L.length) { $('s-50').textContent = $('s-95').textContent = $('s-cov').textContent = '–'; return; }
    const e = L.map(l => l.err); $('s-50').textContent = pct(e, .5).toFixed(2) + ' m'; $('s-95').textContent = pct(e, .95).toFixed(2) + ' m'; $('s-cov').textContent = (L.reduce((a, l) => a + l.inside, 0) / L.length * 100).toFixed(0) + '%';
  }
  /* ---------- drawing ---------- */
  const cv = $('cv'), g = cv.getContext('2d'); let sc = 1, ox = 0, oy = 0;
  const css = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim(), dark = () => css('--bg') === '#0A1A20';
  function draw() {
    const r = cv.getBoundingClientRect(), dpr = window.devicePixelRatio || 1, w = r.width, h = w * 0.68; cv.width = w * dpr; cv.height = h * dpr; cv.style.height = h + 'px'; g.setTransform(dpr, 0, 0, dpr, 0, 0);
    sc = Math.min((w - 40) / S.W, (h - 40) / S.H); ox = (w - S.W * sc) / 2; oy = (h - S.H * sc) / 2; const X = x => ox + x * sc, Y = y => oy + y * sc;
    g.clearRect(0, 0, w, h); g.strokeStyle = css('--grid'); g.lineWidth = 1; g.font = '11px system-ui'; g.fillStyle = css('--ink3');
    for (let x = 0; x <= S.W; x++) { g.beginPath(); g.moveTo(X(x), Y(0)); g.lineTo(X(x), Y(S.H)); g.stroke(); if (x % 2 == 0) g.fillText(x + ' m', X(x) - 8, Y(S.H) + 14); }
    for (let y = 0; y <= S.H; y++) { g.beginPath(); g.moveTo(X(0), Y(y)); g.lineTo(X(S.W), Y(y)); g.stroke(); }
    g.strokeStyle = css('--ink2'); g.lineWidth = 2.5; g.strokeRect(X(0), Y(0), S.W * sc, S.H * sc);
    active().forEach(o => { if (o.s.r != null) { g.strokeStyle = 'rgba(34,195,230,.35)'; g.lineWidth = 1.2; g.setLineDash([4, 4]); g.beginPath(); g.arc(X(o.s.x), Y(o.s.y), o.s.r * sc, 0, 7); g.stroke(); g.setLineDash([]); } });
    if (S.trail.length > 1) { g.strokeStyle = 'rgba(16,185,129,.5)'; g.lineWidth = 2; g.beginPath(); S.trail.forEach((p, i) => i ? g.lineTo(X(p[0]), Y(p[1])) : g.moveTo(X(p[0]), Y(p[1]))); g.stroke(); }
    if (S.out) {
      const o = S.out, ct = Math.cos(o.ell.th), st = Math.sin(o.ell.th); g.beginPath();
      for (let k = 0; k <= 40; k++) { const t = k / 40 * 6.2832, ex = o.ell.a * Math.cos(t), ey = o.ell.b * Math.sin(t), px = o.pos[0] + ex * ct - ey * st, py = o.pos[1] + ex * st + ey * ct; k ? g.lineTo(X(px), Y(py)) : g.moveTo(X(px), Y(py)); }
      g.fillStyle = 'rgba(16,185,129,.12)'; g.fill(); g.strokeStyle = 'rgba(16,185,129,.8)'; g.lineWidth = 1.6; g.stroke();
      g.fillStyle = '#10B981'; g.beginPath(); g.arc(X(o.pos[0]), Y(o.pos[1]), 7, 0, 7); g.fill(); g.strokeStyle = '#fff'; g.lineWidth = 2; g.stroke();
    }
    if (S.truth) { g.strokeStyle = '#22C3E6'; g.lineWidth = 2.5; g.beginPath(); g.arc(X(S.truth[0]), Y(S.truth[1]), 10, 0, 7); g.stroke(); }
    S.slots.forEach((s, i) => {
      const heard = s.on && s.n > 0, x = X(s.x), y = Y(s.y); g.fillStyle = !s.on ? 'rgba(122,154,166,.4)' : heard ? (dark() ? '#E3F4F8' : '#0B3A4A') : '#EF6A6A';
      g.beginPath(); g.moveTo(x, y - 11); g.lineTo(x + 10, y + 8); g.lineTo(x - 10, y + 8); g.closePath(); g.fill();
      g.fillStyle = heard && dark() ? '#0A1A20' : '#fff'; g.font = 'bold 10px system-ui'; g.fillText(i + 1, x - 3, y + 6);
    });
  }
  function ui() {
    const rows = document.querySelectorAll('#tb tbody tr');
    S.slots.forEach((s, i) => { const tr = rows[i]; if (!tr) return; tr.querySelector('.c-r').textContent = s.on && s.rssi != null ? s.rssi + ' dBm' : '–'; tr.querySelector('.c-d').textContent = s.on && s.r != null ? s.r.toFixed(1) + ' m' : '–'; tr.querySelector('.bar i').style.width = (s.on && s.trust != null ? Math.round(s.trust * 100) : 0) + '%'; tr.title = s.why || ''; });
    const o = S.out, act = active(); $('k-n').textContent = act.filter(a => a.s.n > 0).length + ' / ' + act.length;
    if (o) {
      $('k-pos').textContent = o.pos[0].toFixed(1) + ', ' + o.pos[1].toFixed(1); $('k-unc').textContent = '± ' + Math.max(o.ell.a, o.ell.b).toFixed(1) + ' m';
      const worst = act.map((a, j) => ({ a, t: o.trust[j] })).sort((p, q) => p.t - q.t)[0];
      $('n-why').textContent = worst && worst.t < 0.6 ? 'Beacon ' + (worst.a.i + 1) + ' down-weighted: ' + (worst.a.s.why || '') : 'Beacon # is the ID you pick in the app on each beacon phone. Untick one to test losing a beacon.';
    }
  }
  /* ---------- wiring ---------- */
  cv.addEventListener('pointerdown', e => {
    if (S.mode !== 'live' || !S.out) return; const r = cv.getBoundingClientRect(), x = (e.clientX - r.left - ox) / sc, y = (e.clientY - r.top - oy) / sc;
    if (x < 0 || y < 0 || x > S.W || y > S.H) return; S.truth = [x, y]; logErr(S.out.pos, S.truth, S.out.ell);
  });
  document.querySelectorAll('[data-lay]').forEach(b => b.onclick = () => layout(+b.dataset.lay));
  $('b-demo').onclick = () => setMode('demo'); $('b-live').onclick = () => setMode('live'); $('b-conn').onclick = startLive;
  const resize = () => { S.W = Math.max(2, +$('i-W').value || 8); S.H = Math.max(2, +$('i-H').value || 6); demo.pos = [S.W / 2, S.H / 2]; demo.tgt = [S.W / 2, S.H / 2]; layout(S.k); };
  $('i-W').onchange = resize; $('i-H').onchange = resize;
  $('i-n').oninput = () => { S.n = +$('i-n').value; $('v-n').textContent = S.n; }; $('i-p').oninput = () => { S.p1 = +$('i-p').value; $('v-p').textContent = S.p1 + ' dBm'; }; $('i-sig').onchange = () => S.sig = +$('i-sig').value;
  $('b-clear').onclick = () => { S.log = []; stats(); $('k-err').textContent = '–'; };
  $('b-csv').onclick = () => {
    const t = 'time,est_x,est_y,true_x,true_y,error_m,inside_ellipse,beacons\n' + S.log.map(l => [new Date(l.t).toISOString(), l.x.toFixed(3), l.y.toFixed(3), l.tx.toFixed(3), l.ty.toFixed(3), l.err.toFixed(3), l.inside, l.beacons].join(',')).join('\n');
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([t], { type: 'text/csv' })); a.download = 'locus_beacon_log.csv'; a.click();
  };
  $('i-host').value = LS('host') || (phoneServed ? location.host : '');
  layout(3); setMode(phoneServed ? 'live' : 'demo');
  let last = performance.now(), acc = 0;
  setInterval(() => { const n = performance.now(), dt = Math.min(0.5, (n - last) / 1000); last = n; if (S.mode === 'demo') demoTick(dt); acc += dt; if (acc >= 0.25) { acc = 0; try { estimate(); ui(); } catch (e) { console.error(e); } } draw(); }, 80);
  window.__lbl = { S, layout, setMode, estimate, active, demo, logErr };
})();
