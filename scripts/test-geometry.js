require('./ts-require');
const G = require('../src/ink/geometry.ts');
const eq = (a, b, m) => { if (Math.abs(a - b) > 0.11) throw new Error(m + ': ' + a + ' vs ' + b); };

const stroke = { id: 's', k: 's', tool: 'pen', color: '#000', size: 4, pts: [10, 10, 1, 50, 30, 1, 90, 10, 1] };
const b = G.itemBounds(stroke);
eq(b.x0, 8, 'bx0'); eq(b.x1, 92, 'bx1'); eq(b.y0, 8, 'by0'); eq(b.y1, 32, 'by1');

// move + scale about an anchor: p' = s*p + t with anchor a => t = a - s*a
const s = 2, a = [10, 10];
const moved = G.applyAffine(stroke, s, a[0] - s * a[0], a[1] - s * a[1]);
eq(moved.pts[0], 10, 'anchor stays'); eq(moved.pts[3], 90, 'scaled x'); eq(moved.pts[4], 50, 'scaled y'); eq(moved.size, 8, 'size scales');

const shape = { id: 'h', k: 'h', shape: 'rect', color: '#f00', size: 3, x1: 0, y1: 0, x2: 100, y2: 50 };
const sh = G.applyAffine(shape, 0.5, 20, 30);
eq(sh.x2, 70, 'shape x2'); eq(sh.y2, 55, 'shape y2');
const text = { id: 't', k: 't', x: 10, y: 10, w: 200, text: 'hello', color: '#000', fontSize: 20 };
const tx = G.applyAffine(text, 2, 0, 0); eq(tx.fontSize, 40, 'font scales'); eq(tx.w, 400, 'text width');
const img = { id: 'i', k: 'i', x: 5, y: 5, w: 100, h: 60, file: 'a.jpg' };
const im = G.applyAffine(img, 1.5, 10, 10); eq(im.w, 150, 'img w'); eq(im.h, 90, 'img h'); eq(im.x, 17.5, 'img x');

// lasso
const around = [0, 0, 120, 0, 120, 60, 0, 60];
if (!G.lassoHits(stroke, around)) throw new Error('lasso should hit stroke');
if (G.lassoHits(stroke, [200, 200, 300, 200, 300, 300, 200, 300])) throw new Error('lasso far away must miss');
if (!G.lassoHits(img, [0, 0, 200, 0, 200, 200, 0, 200])) throw new Error('lasso should hit image');
if (G.lassoHits(img, [0, 0, 30, 0, 30, 30, 0, 30])) throw new Error('partial lasso must miss image');
// hit tests
if (!G.hitItem(stroke, 50, 31, 4)) throw new Error('tap near stroke should hit');
if (G.hitItem(stroke, 50, 80, 4)) throw new Error('tap far from stroke must miss');
if (!G.hitItem(img, 40, 30, 2)) throw new Error('tap inside image should hit');
if (G.recolorItem(img, '#fff') !== img) throw new Error('images are not recolorable');
if (G.recolorItem(stroke, '#fff').color !== '#fff') throw new Error('recolor stroke');
const u = G.unionBounds([G.itemBounds(stroke), G.itemBounds(img)]);
eq(u.x1, 105, 'union x1');
console.log('geometry OK');
