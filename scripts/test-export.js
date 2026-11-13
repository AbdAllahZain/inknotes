// Verifies the PDF export math with real pdf-lib output (orientation + /Rotate handling).
const ts = require('typescript');
const fs = require('fs');
const path = require('path');
const { PDFDocument, rgb, degrees } = require('pdf-lib');

function load(file) {
  const src = fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
  const js = ts.transpileModule(src, { compilerOptions: { module: 'commonjs', target: 'es2019' } }).outputText;
  const m = { exports: {} };
  new Function('module', 'exports', 'require', js)(m, m.exports, (n) => require(n));
  return m.exports;
}
const E = load('src/ink/engine.ts');
const M = load('src/services/pdfMap.ts');

(async () => {
  const pdf = await PDFDocument.create();
  const sizes = [[300, 400, 0], [300, 400, 90], [300, 400, 180], [300, 400, 270]];
  for (const [w, h, r] of sizes) {
    const pg = pdf.addPage([w, h]);
    pg.setRotation(degrees(r));
    // marker text in PDF space so the rotation is visible
    pg.drawRectangle({ x: 0, y: 0, width: w, height: h, color: rgb(0.95, 0.97, 1) });
  }
  const pages = pdf.getPages();
  for (let i = 0; i < pages.length; i++) {
    const pg = pages[i];
    const r = pg.getRotation().angle;
    const dispW = r % 180 === 0 ? 300 : 400;
    const dispH = r % 180 === 0 ? 400 : 300;
    const p = { id: 'x', w: dispW, h: dispH, bg: 'pdf', items: [] };
    const m = M.makeMapper(pg, p, false);
    // a red "L" shaped stroke near the display top-left and a blue circle at the display centre
    const stroke = [30, 30, 1, 30, 120, 1, 90, 120, 1];
    const poly = E.buildOutline(stroke, 8, 0, 1);
    pg.drawSvgPath(M.polyToSvg(poly, m), { x: 0, y: 0, color: rgb(0.9, 0.1, 0.1), opacity: 1 });
    for (const o of E.shapeOutlines('ellipse', dispW / 2 - 40, dispH / 2 - 40, dispW / 2 + 40, dispH / 2 + 40, 4)) {
      pg.drawSvgPath(M.polyToSvg(o, m), { x: 0, y: 0, color: rgb(0.1, 0.2, 0.9), opacity: 1 });
    }
  }
  fs.writeFileSync('/tmp/export-test.pdf', await pdf.save());
  console.log('wrote /tmp/export-test.pdf');
})();
