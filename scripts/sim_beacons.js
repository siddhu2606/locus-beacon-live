/* How many BLE beacons do you need? RSSI -> range -> LOCUS vs plain least squares, triangle vs line vs square.
   node scripts/sim_beacons.js   (deterministic, writes docs/beacon_study.json + .md) */
const E = require('../src/engine.js'); const fs = require('fs');
const W = 8, H = 6, P1 = -59, N_TRUE = 2.2, N_ASSUMED = 2.2;
const LAYOUTS = {
  '2 beacons (corners)': [[0.3, 0.3], [W - 0.3, 0.3]],
  '3 collinear (line)': [[0.3, H / 2], [W / 2, H / 2], [W - 0.3, H / 2]],
  '3 beacons (triangle)': [[0.3, 0.3], [W - 0.3, 0.3], [W / 2, H - 0.3]],
  '4 beacons (square)': [[0.3, 0.3], [W - 0.3, 0.3], [W - 0.3, H - 0.3], [0.3, H - 0.3]],
  '6 beacons': [[0.3, 0.3], [W / 2, 0.3], [W - 0.3, 0.3], [W - 0.3, H - 0.3], [W / 2, H - 0.3], [0.3, H - 0.3]],
};
const CONDS = { 'calm (σ=2 dB)': { sig: 2, loss: 0.03, body: 0 }, 'typical (σ=4 dB)': { sig: 4, loss: 0.08, body: 0.05 }, 'harsh (σ=6 dB)': { sig: 6, loss: 0.2, body: 0.12 } };
const pct = (a, p) => { const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };
function run(pts, cond, seed) {
  const anchors = pts.map((p, i) => ({ id: 'B' + (i + 1), x: p[0], y: p[1] })); E.setRoom(W, H, anchors, []);
  const rng = E.rngMake(seed), A = E.ANCHORS, L = new E.Locus(A, { sigma: 1.0, rng: E.rngMake(seed + 1), N: 500 });
  let pos = [W / 2, H / 2], tgt = [rng() * W, rng() * H]; const eL = [], eW = [], cover = []; const body = A.map(() => 0);
  for (let t = 0; t < 240; t++) {
    const dx = tgt[0] - pos[0], dy = tgt[1] - pos[1], d = Math.hypot(dx, dy); if (d < 0.4) tgt = [0.5 + rng() * (W - 1), 0.5 + rng() * (H - 1)]; else { pos = [pos[0] + dx / d * 0.5, pos[1] + dy / d * 0.5]; }
    const meas = A.map((a, i) => {
      if (rng() < cond.loss) return null; if (body[i] > 0) body[i]--; else if (rng() < cond.body / 10) body[i] = 8;
      const dd = Math.max(0.3, Math.hypot(pos[0] - a.x, pos[1] - a.y)), rssi = P1 - 10 * N_TRUE * Math.log10(dd) + cond.sig * rng.g() - (body[i] > 0 ? 8 : 0);
      const r = Math.min(30, Math.pow(10, (P1 - rssi) / (10 * N_ASSUMED))); return { r, s: r * 0.2303 * 3.0 / N_ASSUMED };
    });
    const o = L.step(meas, 0.5); const w = E.lsFix(A, meas, [W / 2, H / 2]);
    if (t > 20 && o) { eL.push(Math.hypot(o.pos[0] - pos[0], o.pos[1] - pos[1])); if (w) eW.push(Math.hypot(w[0] - pos[0], w[1] - pos[1])); const dx2 = pos[0] - o.pos[0], dy2 = pos[1] - o.pos[1], c = Math.cos(o.ell.th), s = Math.sin(o.ell.th), u = (dx2 * c + dy2 * s) / o.ell.a, v = (-dx2 * s + dy2 * c) / o.ell.b; cover.push(u * u + v * v <= 1 ? 1 : 0); }
  }
  return { eL, eW, cover };
}
const out = {}; let md = '| Condition | Layout | LOCUS median (m) | LOCUS 90th (m) | Plain LS median (m) | 90% ellipse covers |\n|---|---|---|---|---|---|\n';
for (const [cn, c] of Object.entries(CONDS)) for (const [ln, pts] of Object.entries(LAYOUTS)) {
  let eL = [], eW = [], cv = []; for (let s = 0; s < 24; s++) { const r = run(pts, c, 100 + s * 7); eL = eL.concat(r.eL); eW = eW.concat(r.eW); cv = cv.concat(r.cover); }
  const row = { median: pct(eL, .5), p90: pct(eL, .9), lsMedian: eW.length ? pct(eW, .5) : null, coverage: cv.reduce((a, b) => a + b, 0) / cv.length }; (out[cn] = out[cn] || {})[ln] = row;
  md += `| ${cn} | ${ln} | ${row.median.toFixed(2)} | ${row.p90.toFixed(2)} | ${row.lsMedian == null ? '–' : row.lsMedian.toFixed(2)} | ${(row.coverage * 100).toFixed(0)}% |\n`;
}
fs.writeFileSync(__dirname + '/../docs/beacon_study.json', JSON.stringify(out, null, 1)); fs.writeFileSync(__dirname + '/../docs/beacon_study.md', md); console.log(md);
