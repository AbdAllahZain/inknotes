// Sanity test for the ink engine (runs in plain Node).
const ts = require('typescript');
const fs = require('fs');
const path = require('path');
const src = fs.readFileSync(path.join(__dirname, '../src/ink/engine.ts'), 'utf8');
const js = ts.transpileModule(src, { compilerOptions: { module: 'commonjs', target: 'es2019' } }).outputText;
const m = { exports: {} };
new Function('module', 'exports', js)(m, m.exports);
const E = m.exports;

const st = E.newFilterState();
const pts = [];
let p = 0.6;
let prev = null;
for (let i = 0; i <= 160; i++) {
  const a = (i / 160) * Math.PI * 1.8;
  const rx = 120 + Math.cos(a) * 80 + (Math.random() - 0.5) * 2.2;
  const ry = 120 + Math.sin(a) * 80 + (Math.random() - 0.5) * 2.2;
  E.oneEuroStep(st, rx, ry, i * 8, 1.6, 0.02);
  const speed = prev ? Math.hypot(st[0] - prev[0], st[1] - prev[1]) / 0.008 : 0;
  p = E.simulatePressure(p, speed);
  pts.push(st[0], st[1], p);
  prev = [st[0], st[1]];
}
const poly = E.buildOutline(pts, 5, 0.8, 0.35);
if (!poly.length || poly.some((v) => !isFinite(v))) throw new Error('bad outline');
if (E.buildOutline([10, 10, 1], 6, 0, 1).length !== 32) throw new Error('bad dot');
if (E.shapeOutlines('rect', 10, 10, 100, 80, 3).length !== 4) throw new Error('bad rect');
if (E.shapeOutlines('arrow', 10, 10, 100, 80, 3).length !== 3) throw new Error('bad arrow');
if (Math.abs(E.distToPolyline(120, 40, [0, 0, 1, 100, 0, 1, 100, 100, 1]) - 20) > 1e-6) throw new Error('bad dist');
let d = 'M' + poly[0].toFixed(2) + ' ' + poly[1].toFixed(2);
for (let i = 2; i < poly.length; i += 2) d += 'L' + poly[i].toFixed(2) + ' ' + poly[i + 1].toFixed(2);
fs.writeFileSync('/tmp/ink-preview.svg', `<svg xmlns="http://www.w3.org/2000/svg" width="260" height="260"><rect width="260" height="260" fill="white"/><path d="${d}Z" fill="black"/></svg>`);
console.log('ink engine OK, outline vertices:', poly.length / 2);

// ---- shape recognition
function mk(points) { const a = []; for (const [x, y] of points) a.push(x, y, 1); return a; }
function noise(v) { return v + (Math.random() - 0.5) * 3; }
const wobblyLine = []; for (let i = 0; i <= 40; i++) wobblyLine.push([50 + i * 5, 100 + i * 1.2 + (Math.random() - 0.5) * 3]);
const rl = E.recognizeShape(mk(wobblyLine)); if (rl[0] !== 1) throw new Error('line not recognised ' + rl);
const circle = []; for (let i = 0; i <= 60; i++) { const a = i / 60 * Math.PI * 2.05; circle.push([noise(200 + Math.cos(a) * 60), noise(200 + Math.sin(a) * 40)]); }
const rc = E.recognizeShape(mk(circle)); if (rc[0] !== 2) throw new Error('ellipse not recognised ' + rc);
const rect = []; const R = [[100, 100], [220, 100], [220, 180], [100, 180], [100, 100]];
for (let s = 0; s < 4; s++) for (let t = 0; t < 15; t++) rect.push([noise(R[s][0] + (R[s + 1][0] - R[s][0]) * t / 15), noise(R[s][1] + (R[s + 1][1] - R[s][1]) * t / 15)]);
rect.push([noise(100), noise(102)]);
const rr = E.recognizeShape(mk(rect)); if (rr[0] !== 3) throw new Error('rect not recognised ' + rr);
const zig = []; for (let i = 0; i < 40; i++) zig.push([50 + i * 5, 100 + (i % 2 ? 25 : -25)]);
if (E.recognizeShape(mk(zig))[0] !== 0) throw new Error('zigzag should not snap');
const arc = []; for (let i = 0; i <= 40; i++) { const a = i / 40 * Math.PI; arc.push([200 + Math.cos(a) * 80, 200 + Math.sin(a) * 80]); }
if (E.recognizeShape(mk(arc))[0] !== 0) throw new Error('open arc should not snap');
console.log('shape recognition OK');
