require('./ts-require');
const { applyOp } = require('../src/editor/history.ts');
const mk = (id) => ({ id, k: 'h', shape: 'line', color: '#000', size: 2, x1: 0, y1: 0, x2: 10, y2: 10 });
const doc = { id: 'd', title: 't', type: 'note', createdAt: 0, updatedAt: 0, pages: [
  { id: 'p1', w: 100, h: 100, bg: 'blank', items: [mk('a'), mk('b')] },
  { id: 'p2', w: 100, h: 100, bg: 'blank', items: [] },
  { id: 'p3', w: 100, h: 100, bg: 'lined', items: [] } ] };
const ids = (d) => d.pages.map((p) => p.id).join(',');
// xform: replace + undo restores
const before = [doc.pages[0].items[0]]; const after = [{ ...before[0], x2: 99 }];
const op = { t: 'xform', pageId: 'p1', before, after };
const d1 = applyOp(doc, op, false); if (d1.pages[0].items[0].x2 !== 99 || d1.pages[0].items[1].id !== 'b') throw new Error('xform apply');
const d2 = applyOp(d1, op, true); if (d2.pages[0].items[0].x2 !== 10) throw new Error('xform undo');
// movePage + undo
const mv = { t: 'movePage', from: 0, to: 2 };
const m1 = applyOp(doc, mv, false); if (ids(m1) !== 'p2,p3,p1') throw new Error('move ' + ids(m1));
if (ids(applyOp(m1, mv, true)) !== 'p1,p2,p3') throw new Error('move undo');
// addMany + undo
const am = { t: 'addMany', entries: [{ pageId: 'p2', item: mk('x') }, { pageId: 'p2', item: mk('y') }] };
const a1 = applyOp(doc, am, false); if (a1.pages[1].items.length !== 2) throw new Error('addMany');
if (applyOp(a1, am, true).pages[1].items.length !== 0) throw new Error('addMany undo');
// pages untouched keep identity (needed so memoised page pictures are not rebuilt)
if (a1.pages[0] !== doc.pages[0]) throw new Error('unrelated page identity changed');
console.log('history OK');
