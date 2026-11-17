/**
 * Ink engine: smoothing + pressure + stroke outline generation.
 * Every function is a Reanimated worklet so it can run on the UI thread
 * (live drawing) AND on the JS thread (committed strokes / PDF export).
 * Points are stored flat: [x, y, pressure, x, y, pressure, ...]
 */

export type Poly = number[]; // flat [x,y,x,y,...] closed polygon
export type ShapeKind = 'line' | 'arrow' | 'rect' | 'ellipse';

// ---------------------------------------------------------------- filtering

/** One-Euro filter state: [x, y, dx, dy, tLast, initialised] */
export function newFilterState(): number[] {
  'worklet';
  return [0, 0, 0, 0, 0, 0];
}

function alphaFor(dt: number, cutoff: number): number {
  'worklet';
  const tau = 1 / (2 * Math.PI * cutoff);
  return 1 / (1 + tau / dt);
}

/**
 * Adaptive low-pass filter: heavy smoothing when the pen is slow (removes
 * digitizer jitter on cheap touch screens), light smoothing when fast (no lag).
 * Result is written to s[0], s[1].
 */
export function oneEuroStep(
  s: number[],
  x: number,
  y: number,
  tMs: number,
  minCutoff: number,
  beta: number
): void {
  'worklet';
  if (s[5] === 0) {
    s[0] = x;
    s[1] = y;
    s[2] = 0;
    s[3] = 0;
    s[4] = tMs;
    s[5] = 1;
    return;
  }
  let dt = (tMs - s[4]) / 1000;
  if (dt < 0.002) dt = 0.002;
  if (dt > 0.05) dt = 0.05;
  s[4] = tMs;
  const aD = alphaFor(dt, 1.0);
  const dx = (x - s[0]) / dt;
  const dy = (y - s[1]) / dt;
  s[2] = s[2] + aD * (dx - s[2]);
  s[3] = s[3] + aD * (dy - s[3]);
  const speed = Math.sqrt(s[2] * s[2] + s[3] * s[3]);
  const a = alphaFor(dt, minCutoff + beta * speed);
  s[0] = s[0] + a * (x - s[0]);
  s[1] = s[1] + a * (y - s[1]);
}

/** Pressure for devices without a pressure sensor: slow = thick, fast = thin. */
export function simulatePressure(prev: number, speedPerSec: number): number {
  'worklet';
  let v = speedPerSec / 1800;
  if (v > 1) v = 1;
  const target = 1 - v * 0.65;
  return prev + 0.18 * (target - prev);
}

/** Real stylus pressure, gently curved and smoothed. */
export function stylusPressure(prev: number, raw: number): number {
  'worklet';
  let r = raw;
  if (r < 0) r = 0;
  if (r > 1) r = 1;
  const curved = Math.pow(r, 0.75);
  return prev + 0.4 * (curved - prev);
}

// ------------------------------------------------------------------ outline

function widthRadius(p: number, maxR: number, gain: number, minFrac: number): number {
  'worklet';
  let f = 1 - gain * (1 - p);
  if (f < minFrac) f = minFrac;
  return maxR * f;
}

/**
 * Turn a pressure-annotated polyline into a closed polygon outline with round caps.
 * @param pts   flat [x,y,p,...]
 * @param size  maximum stroke width (page units)
 * @param gain  0 = constant width, 1 = fully pressure driven
 * @param minFrac smallest width as fraction of size
 */
export function buildOutline(pts: number[], size: number, gain: number, minFrac: number): Poly {
  'worklet';
  const out: number[] = [];
  const n0 = Math.floor(pts.length / 3);
  if (n0 === 0) return out;
  const maxR = size / 2;

  // 1) drop (near) duplicate points
  const px: number[] = [];
  const py: number[] = [];
  const pp: number[] = [];
  const minD = Math.max(0.05, size * 0.04);
  for (let i = 0; i < n0; i++) {
    const x = pts[i * 3];
    const y = pts[i * 3 + 1];
    const p = pts[i * 3 + 2];
    const k = px.length;
    if (k > 0) {
      const dx = x - px[k - 1];
      const dy = y - py[k - 1];
      if (dx * dx + dy * dy < minD * minD) {
        pp[k - 1] = p;
        continue;
      }
    }
    px.push(x);
    py.push(y);
    pp.push(p);
  }
  const n = px.length;

  // dot
  if (n === 1) {
    const r = widthRadius(pp[0], maxR, gain, minFrac);
    const steps = 16;
    for (let a = 0; a < steps; a++) {
      const ang = (a / steps) * Math.PI * 2;
      out.push(px[0] + Math.cos(ang) * r, py[0] + Math.sin(ang) * r);
    }
    return out;
  }

  // 2) smooth centre line (quadratic through midpoints) -> dense samples
  const cx: number[] = [];
  const cy: number[] = [];
  const cr: number[] = [];
  const step = Math.max(0.8, size * 0.35);

  cx.push(px[0]);
  cy.push(py[0]);
  cr.push(widthRadius(pp[0], maxR, gain, minFrac));

  if (n === 2) {
    const len = Math.sqrt((px[1] - px[0]) * (px[1] - px[0]) + (py[1] - py[0]) * (py[1] - py[0]));
    const k = Math.max(1, Math.min(60, Math.ceil(len / step)));
    for (let s = 1; s <= k; s++) {
      const t = s / k;
      cx.push(px[0] + (px[1] - px[0]) * t);
      cy.push(py[0] + (py[1] - py[0]) * t);
      cr.push(widthRadius(pp[0] + (pp[1] - pp[0]) * t, maxR, gain, minFrac));
    }
  } else {
    let sx = px[0];
    let sy = py[0];
    let sp = pp[0];
    for (let i = 1; i < n - 1; i++) {
      const mx = (px[i] + px[i + 1]) / 2;
      const my = (py[i] + py[i + 1]) / 2;
      const mp = (pp[i] + pp[i + 1]) / 2;
      const approx =
        Math.sqrt((px[i] - sx) * (px[i] - sx) + (py[i] - sy) * (py[i] - sy)) +
        Math.sqrt((mx - px[i]) * (mx - px[i]) + (my - py[i]) * (my - py[i]));
      const k = Math.max(1, Math.min(14, Math.ceil(approx / step)));
      for (let s = 1; s <= k; s++) {
        const t = s / k;
        const u = 1 - t;
        cx.push(u * u * sx + 2 * u * t * px[i] + t * t * mx);
        cy.push(u * u * sy + 2 * u * t * py[i] + t * t * my);
        cr.push(widthRadius(sp + (mp - sp) * t, maxR, gain, minFrac));
      }
      sx = mx;
      sy = my;
      sp = mp;
    }
    const lx = px[n - 1];
    const ly = py[n - 1];
    const len = Math.sqrt((lx - sx) * (lx - sx) + (ly - sy) * (ly - sy));
    const k = Math.max(1, Math.min(30, Math.ceil(len / step)));
    for (let s = 1; s <= k; s++) {
      const t = s / k;
      cx.push(sx + (lx - sx) * t);
      cy.push(sy + (ly - sy) * t);
      cr.push(widthRadius(sp + (pp[n - 1] - sp) * t, maxR, gain, minFrac));
    }
  }

  // 3) smooth radii a little (removes pressure noise)
  const m = cx.length;
  if (m > 2) {
    let prev = cr[0];
    for (let j = 1; j < m; j++) {
      prev = prev + 0.5 * (cr[j] - prev);
      cr[j] = prev;
    }
  }

  // 4) normals
  const nx: number[] = new Array(m);
  const ny: number[] = new Array(m);
  const tx: number[] = new Array(m);
  const ty: number[] = new Array(m);
  let lastTx = 1;
  let lastTy = 0;
  for (let j = 0; j < m; j++) {
    const a = j > 0 ? j - 1 : 0;
    const b = j < m - 1 ? j + 1 : m - 1;
    let dx = cx[b] - cx[a];
    let dy = cy[b] - cy[a];
    const l = Math.sqrt(dx * dx + dy * dy);
    if (l < 1e-6) {
      dx = lastTx;
      dy = lastTy;
    } else {
      dx /= l;
      dy /= l;
      lastTx = dx;
      lastTy = dy;
    }
    tx[j] = dx;
    ty[j] = dy;
    nx[j] = -dy;
    ny[j] = dx;
  }

  // 5) polygon: left side -> end cap -> right side (reversed) -> start cap
  for (let j = 0; j < m; j++) {
    out.push(cx[j] + nx[j] * cr[j], cy[j] + ny[j] * cr[j]);
  }
  const capSteps = 7;
  for (let a = 1; a < capSteps; a++) {
    const phi = (a / capSteps) * Math.PI;
    const c = Math.cos(phi);
    const s = Math.sin(phi);
    out.push(
      cx[m - 1] + (nx[m - 1] * c + tx[m - 1] * s) * cr[m - 1],
      cy[m - 1] + (ny[m - 1] * c + ty[m - 1] * s) * cr[m - 1]
    );
  }
  for (let j = m - 1; j >= 0; j--) {
    out.push(cx[j] - nx[j] * cr[j], cy[j] - ny[j] * cr[j]);
  }
  for (let a = 1; a < capSteps; a++) {
    const phi = (a / capSteps) * Math.PI;
    const c = Math.cos(phi);
    const s = Math.sin(phi);
    out.push(
      cx[0] + (-nx[0] * c - tx[0] * s) * cr[0],
      cy[0] + (-ny[0] * c - ty[0] * s) * cr[0]
    );
  }
  return out;
}

// ------------------------------------------------------------------- shapes

/** Polylines (flat [x,y,p,...], p=1) that make up a shape. */
export function shapePolylines(
  kind: ShapeKind,
  x1: number,
  y1: number,
  x2: number,
  y2: number
): number[][] {
  'worklet';
  const res: number[][] = [];
  if (kind === 'line') {
    res.push([x1, y1, 1, x2, y2, 1]);
  } else if (kind === 'arrow') {
    res.push([x1, y1, 1, x2, y2, 1]);
    const dx = x2 - x1;
    const dy = y2 - y1;
    const l = Math.sqrt(dx * dx + dy * dy);
    if (l > 1) {
      const ux = dx / l;
      const uy = dy / l;
      const head = Math.min(26, Math.max(10, l * 0.22));
      const ang = Math.PI / 7;
      const c = Math.cos(ang);
      const s = Math.sin(ang);
      const ax = -ux * c + uy * s;
      const ay = -uy * c - ux * s;
      const bx = -ux * c - uy * s;
      const by = -uy * c + ux * s;
      res.push([x2, y2, 1, x2 + ax * head, y2 + ay * head, 1]);
      res.push([x2, y2, 1, x2 + bx * head, y2 + by * head, 1]);
    }
  } else if (kind === 'rect') {
    res.push([x1, y1, 1, x2, y1, 1]);
    res.push([x2, y1, 1, x2, y2, 1]);
    res.push([x2, y2, 1, x1, y2, 1]);
    res.push([x1, y2, 1, x1, y1, 1]);
  } else {
    const cx = (x1 + x2) / 2;
    const cy = (y1 + y2) / 2;
    const rx = Math.abs(x2 - x1) / 2;
    const ry = Math.abs(y2 - y1) / 2;
    const steps = Math.max(24, Math.min(96, Math.ceil((rx + ry) / 3)));
    const pl: number[] = [];
    for (let i = 0; i <= steps; i++) {
      const a = (i / steps) * Math.PI * 2;
      pl.push(cx + Math.cos(a) * rx, cy + Math.sin(a) * ry, 1);
    }
    res.push(pl);
  }
  return res;
}

/** All outline polygons for a shape. */
export function shapeOutlines(
  kind: ShapeKind,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  size: number
): Poly[] {
  'worklet';
  const lines = shapePolylines(kind, x1, y1, x2, y2);
  const res: Poly[] = [];
  for (let i = 0; i < lines.length; i++) {
    res.push(buildOutline(lines[i], size, 0, 1));
  }
  return res;
}

// -------------------------------------------------------------- hit testing

export function distToSegment(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number
): number {
  'worklet';
  const dx = bx - ax;
  const dy = by - ay;
  const l2 = dx * dx + dy * dy;
  let t = 0;
  if (l2 > 0) {
    t = ((px - ax) * dx + (py - ay) * dy) / l2;
    if (t < 0) t = 0;
    if (t > 1) t = 1;
  }
  const qx = ax + dx * t;
  const qy = ay + dy * t;
  const ex = px - qx;
  const ey = py - qy;
  return Math.sqrt(ex * ex + ey * ey);
}

/** Min distance from a point to a flat polyline [x,y,p,...]. */
export function distToPolyline(px: number, py: number, pts: number[]): number {
  'worklet';
  const n = Math.floor(pts.length / 3);
  if (n === 0) return 1e9;
  if (n === 1) {
    const dx = px - pts[0];
    const dy = py - pts[1];
    return Math.sqrt(dx * dx + dy * dy);
  }
  let best = 1e9;
  for (let i = 0; i < n - 1; i++) {
    const d = distToSegment(px, py, pts[i * 3], pts[i * 3 + 1], pts[i * 3 + 3], pts[i * 3 + 4]);
    if (d < best) best = d;
  }
  return best;
}

// ------------------------------------------------------------ shape snapping

/**
 * "Hold to snap": decides whether a freehand stroke was meant to be a straight line,
 * an ellipse or a rectangle.
 * Returns [kind, x1, y1, x2, y2] with kind 0 = none, 1 = line, 2 = ellipse, 3 = rectangle.
 */
export function recognizeShape(pts: number[]): number[] {
  'worklet';
  const none = [0, 0, 0, 0, 0];
  const n = Math.floor(pts.length / 3);
  if (n < 8) return none;
  let minX = 1e9;
  let minY = 1e9;
  let maxX = -1e9;
  let maxY = -1e9;
  let len = 0;
  for (let i = 0; i < n; i++) {
    const x = pts[i * 3];
    const y = pts[i * 3 + 1];
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
    if (i > 0) {
      const dx = x - pts[i * 3 - 3];
      const dy = y - pts[i * 3 - 2];
      len += Math.sqrt(dx * dx + dy * dy);
    }
  }
  const w = maxX - minX;
  const h = maxY - minY;
  const diag = Math.sqrt(w * w + h * h);
  if (len < 30 || diag < 20) return none;

  const sx = pts[0];
  const sy = pts[1];
  const ex = pts[(n - 1) * 3];
  const ey = pts[(n - 1) * 3 + 1];
  const chord = Math.sqrt((ex - sx) * (ex - sx) + (ey - sy) * (ey - sy));

  // straight line: chord is almost as long as the path and nothing bulges away from it
  if (chord > 20 && chord / len > 0.88) {
    let maxDev = 0;
    for (let i = 0; i < n; i++) {
      const cross = Math.abs((ex - sx) * (sy - pts[i * 3 + 1]) - (sx - pts[i * 3]) * (ey - sy));
      const dev = cross / chord;
      if (dev > maxDev) maxDev = dev;
    }
    if (maxDev / chord < 0.07) return [1, sx, sy, ex, ey];
    return none;
  }

  // closed figure: ellipse or rectangle
  if (chord < 0.22 * diag && len > 0.6 * (w + h) && w > 14 && h > 14) {
    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;
    const rx = w / 2;
    const ry = h / 2;
    let eSum = 0;
    let rSum = 0;
    for (let i = 0; i < n; i++) {
      const u = (pts[i * 3] - cx) / rx;
      const v = (pts[i * 3 + 1] - cy) / ry;
      eSum += Math.abs(Math.sqrt(u * u + v * v) - 1);
      const du = Math.abs(Math.abs(u) - 1);
      const dv = Math.abs(Math.abs(v) - 1);
      rSum += du < dv ? du : dv;
    }
    const eScore = eSum / n;
    const rScore = rSum / n;
    if (eScore < 0.13 && eScore <= rScore) return [2, minX, minY, maxX, maxY];
    if (rScore < 0.11) return [3, minX, minY, maxX, maxY];
  }
  return none;
}
