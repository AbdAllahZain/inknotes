// Mirrors exporter.ts page assembly: copy pages from a source PDF in a NEW order (with /Rotate and CropBox),
// add a blank page, then draw ink with the same coordinate mapper. Renders to PNG for visual checking.
require('./ts-require');
const fs = require('fs');
const { PDFDocument, rgb, degrees } = require('pdf-lib');
const E = require('../src/ink/engine.ts');
const M = require('../src/services/pdfMap.ts');

(async () => {
  // source: 3 pages, page 2 rotated 90, page 3 with a CropBox
  const src = await PDFDocument.create();
  const labels = ['A', 'B (rot 90)', 'C (crop)'];
  for (let i = 0; i < 3; i++) {
    const pg = src.addPage([300, 400]);
    pg.drawRectangle({ x: 0, y: 0, width: 300, height: 400, color: [rgb(0.93, 0.96, 1), rgb(1, 0.95, 0.9), rgb(0.92, 1, 0.93)][i] });
    pg.drawText(labels[i], { x: 20, y: 360, size: 28 });
    if (i === 1) pg.setRotation(degrees(90));
    if (i === 2) pg.setCropBox(30, 40, 240, 320);
  }
  const srcBytes = await src.save();
  const loaded = await PDFDocument.load(srcBytes);

  // doc page order: C, A(dup), blank note page, B
  const order = [{ idx: 2 }, { idx: 0 }, { blank: true }, { idx: 1 }];
  const out = await PDFDocument.create();
  for (const o of order) {
    let page, fromSource = false, w, h;
    if (!o.blank) {
      const [copied] = await out.copyPages(loaded, [o.idx]);
      page = out.addPage(copied); fromSource = true;
      const rot = page.getRotation().angle; const cb = page.getCropBox();
      w = rot % 180 === 0 ? cb.width : cb.height; h = rot % 180 === 0 ? cb.height : cb.width;
    } else { w = 300; h = 400; page = out.addPage([w, h]); page.drawText('blank page', { x: 20, y: 360, size: 20 }); }
    const p = { id: 'x', w: Math.round(w), h: Math.round(h), bg: fromSource ? 'pdf' : 'blank', items: [] };
    const m = M.makeMapper(page, p, !fromSource);
    // red L near the display top-left, blue circle at display centre
    const poly = E.buildOutline([25, 25, 1, 25, 90, 1, 70, 90, 1], 7, 0, 1);
    page.drawSvgPath(M.polyToSvg(poly, m), { x: 0, y: 0, color: rgb(0.9, 0.1, 0.1), opacity: 1 });
    for (const o2 of E.shapeOutlines('ellipse', p.w / 2 - 30, p.h / 2 - 30, p.w / 2 + 30, p.h / 2 + 30, 4))
      page.drawSvgPath(M.polyToSvg(o2, m), { x: 0, y: 0, color: rgb(0.1, 0.2, 0.9), opacity: 1 });
  }
  fs.writeFileSync('/tmp/order-test.pdf', await out.save());
  console.log('pages in output:', out.getPageCount(), '| rotation of 4th page:', out.getPage(3).getRotation().angle);
})();
