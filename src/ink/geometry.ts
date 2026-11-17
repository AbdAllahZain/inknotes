import type { Item, TextItem } from '../types';
import { distToPolyline, shapePolylines } from './engine';

export type Bounds = { x0: number; y0: number; x1: number; y1: number };
export type Measure = (t: TextItem) => { w: number; h: number };

function defaultMeasure(t: TextItem) {
  const lines = Math.max(1, t.text.split('\n').length);
  return { w: t.w, h: t.fontSize * 1.4 * lines };
}

export function itemBounds(it: Item, measure: Measure = defaultMeasure): Bounds {
  if (it.k === 's') {
    let x0 = 1e9;
    let y0 = 1e9;
    let x1 = -1e9;
    let y1 = -1e9;
    for (let i = 0; i + 2 < it.pts.length + 1; i += 3) {
      const x = it.pts[i];
      const y = it.pts[i + 1];
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
    const r = it.size / 2;
    return { x0: x0 - r, y0: y0 - r, x1: x1 + r, y1: y1 + r };
  }
  if (it.k === 'h') {
    const r = it.size / 2;
    return {
      x0: Math.min(it.x1, it.x2) - r,
      y0: Math.min(it.y1, it.y2) - r,
      x1: Math.max(it.x1, it.x2) + r,
      y1: Math.max(it.y1, it.y2) + r,
    };
  }
  if (it.k === 't') {
    const m = measure(it);
    return { x0: it.x, y0: it.y, x1: it.x + m.w, y1: it.y + m.h };
  }
  return { x0: it.x, y0: it.y, x1: it.x + it.w, y1: it.y + it.h };
}

export function unionBounds(list: Bounds[]): Bounds {
  let x0 = 1e9;
  let y0 = 1e9;
  let x1 = -1e9;
  let y1 = -1e9;
  for (const b of list) {
    if (b.x0 < x0) x0 = b.x0;
    if (b.y0 < y0) y0 = b.y0;
    if (b.x1 > x1) x1 = b.x1;
    if (b.y1 > y1) y1 = b.y1;
  }
  return { x0, y0, x1, y1 };
}

/** p' = s * p + t   (uniform scale + translation), applied to every coordinate of the item. */
export function applyAffine(it: Item, s: number, tx: number, ty: number): Item {
  const r1 = (v: number) => Math.round(v * 10) / 10;
  if (it.k === 's') {
    const pts: number[] = new Array(it.pts.length);
    for (let i = 0; i < it.pts.length; i += 3) {
      pts[i] = r1(it.pts[i] * s + tx);
      pts[i + 1] = r1(it.pts[i + 1] * s + ty);
      pts[i + 2] = it.pts[i + 2];
    }
    return { ...it, pts, size: Math.max(0.4, Math.round(it.size * s * 100) / 100) };
  }
  if (it.k === 'h') {
    return {
      ...it,
      x1: r1(it.x1 * s + tx),
      y1: r1(it.y1 * s + ty),
      x2: r1(it.x2 * s + tx),
      y2: r1(it.y2 * s + ty),
      size: Math.max(0.4, Math.round(it.size * s * 100) / 100),
    };
  }
  if (it.k === 't') {
    return {
      ...it,
      x: r1(it.x * s + tx),
      y: r1(it.y * s + ty),
      w: Math.max(40, r1(it.w * s)),
      fontSize: Math.max(6, Math.round(it.fontSize * s * 10) / 10),
    };
  }
  return { ...it, x: r1(it.x * s + tx), y: r1(it.y * s + ty), w: Math.max(8, r1(it.w * s)), h: Math.max(8, r1(it.h * s)) };
}

export function offsetItem(it: Item, dx: number, dy: number): Item {
  return applyAffine(it, 1, dx, dy);
}

export function recolorItem(it: Item, color: string): Item {
  if (it.k === 'i') return it;
  return { ...it, color };
}

export function pointInPolygon(x: number, y: number, poly: number[]): boolean {
  let inside = false;
  const n = poly.length / 2;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = poly[i * 2];
    const yi = poly[i * 2 + 1];
    const xj = poly[j * 2];
    const yj = poly[j * 2 + 1];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** A lasso selects an item when at least half of its sample points are inside it. */
export function lassoHits(it: Item, poly: number[], measure?: Measure): boolean {
  if (poly.length < 6) return false;
  const samples: number[] = [];
  if (it.k === 's') {
    const n = Math.floor(it.pts.length / 3);
    const step = Math.max(1, Math.floor(n / 24));
    for (let i = 0; i < n; i += step) samples.push(it.pts[i * 3], it.pts[i * 3 + 1]);
  } else {
    const b = itemBounds(it, measure);
    samples.push(b.x0, b.y0, b.x1, b.y0, b.x0, b.y1, b.x1, b.y1, (b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2);
  }
  let inside = 0;
  const total = samples.length / 2;
  for (let i = 0; i < samples.length; i += 2) if (pointInPolygon(samples[i], samples[i + 1], poly)) inside++;
  return total > 0 && inside / total >= 0.5;
}

/** Hit test used by the eraser and by tap-to-select. r is the touch radius in page units. */
export function hitItem(it: Item, x: number, y: number, r: number, measure?: Measure): boolean {
  if (it.k === 's') return distToPolyline(x, y, it.pts) <= r + it.size / 2;
  if (it.k === 'h') {
    const lines = shapePolylines(it.shape, it.x1, it.y1, it.x2, it.y2);
    for (const l of lines) if (distToPolyline(x, y, l) <= r + it.size / 2) return true;
    return false;
  }
  const b = itemBounds(it, measure);
  return x >= b.x0 - r && x <= b.x1 + r && y >= b.y0 - r && y <= b.y1 + r;
}
