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
