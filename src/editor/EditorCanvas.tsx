import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { LayoutChangeEvent, StyleSheet, View } from 'react-native';
import {
  Canvas,
  Circle,
  DashPathEffect,
  Group,
  Path,
  Picture,
  Rect,
  RoundedRect,
  Skia,
} from '@shopify/react-native-skia';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import {
  cancelAnimation,
  runOnJS,
  useAnimatedReaction,
  useDerivedValue,
  useFrameCallback,
  useSharedValue,
  withDecay,
  withTiming,
} from 'react-native-reanimated';
import {
  buildOutline,
  newFilterState,
  oneEuroStep,
  recognizeShape,
  shapeOutlines,
  simulatePressure,
  stylusPressure,
  type ShapeKind,
} from '../ink/engine';
import type { Bounds } from '../ink/geometry';
import { appendPoly, createItemsPicture } from '../ink/render';
import { PRESETS } from '../tools';
import { useTheme } from '../appTheme';
import type { InkTool, Item, Page, ShapeItem, StrokeItem, ToolId } from '../types';
import { uid } from '../services/storage';
import { PageLayer } from './PageLayer';

const MARGIN = 10;
const GAP = 14;
const RULER_TH = 56;

// presets as plain numbers so worklets can capture them
const PRESET_NUMS: Record<string, number[]> = {};
(Object.keys(PRESETS) as (keyof typeof PRESETS)[]).forEach((k) => {
  const p = PRESETS[k];
  PRESET_NUMS[k] = [p.gain, p.minFrac, p.opacity, p.fingerCutoff, p.fingerBeta, p.penCutoff, p.penBeta];
});

export type GotoRequest = { page: number; nonce: number; instant?: boolean };
export type SelectionSnap = { pageIndex: number; items: Item[]; bounds: Bounds };

type Props = {
  docId: string;
  pages: Page[];
  tool: ToolId;
  color: string;
  size: number;
  shape: ShapeKind;
  stylusOnly: boolean;
  gotoRequest: GotoRequest | null;
  fitNonce: number;
  selection: SelectionSnap | null;
  rulerOn: boolean;
  onAddItem: (pageIndex: number, item: StrokeItem | ShapeItem) => void;
  onEraseAt: (pageIndex: number, x: number, y: number, r: number) => void;
  onEraseEnd: () => void;
  onTextTap: (pageIndex: number, x: number, y: number) => void;
  onCurrentPage: (index: number) => void;
  onSelectTap: (pageIndex: number, x: number, y: number) => void;
  onLasso: (pageIndex: number, poly: number[]) => void;
  onSelectionTransform: (s: number, tx: number, ty: number) => void;
};

function computeLayout(pages: Page[]) {
  let maxW = 0;
  for (const p of pages) if (p.w > maxW) maxW = p.w;
  const contentW = maxW + MARGIN * 2;
  const flat: number[] = [];
  let y = MARGIN;
  for (const p of pages) {
    flat.push((contentW - p.w) / 2, y, p.w, p.h);
    y += p.h + GAP;
  }
  const contentH = y - GAP + MARGIN;
  return { flat, contentW, contentH };
}

export function EditorCanvas(props: Props) {
  const { docId, pages, tool, color, size, shape, stylusOnly, selection, rulerOn } = props;
  const theme = useTheme();
  const cb = useRef(props);
  cb.current = props;

  // ---- layout ---------------------------------------------------------------
  const layout = useMemo(() => computeLayout(pages), [pages.length, pages.map((p) => p.w + 'x' + p.h).join('|')]);
  const layoutSV = useSharedValue<number[]>(layout.flat);
  const contentW = useSharedValue(layout.contentW);
  const contentH = useSharedValue(layout.contentH);
  const viewW = useSharedValue(0);
  const viewH = useSharedValue(0);
  const tx = useSharedValue(0);
  const ty = useSharedValue(0);
  const sc = useSharedValue(1);
  const inited = useSharedValue(0);

  // ---- tool state mirrored into shared values -------------------------------
  const toolSV = useSharedValue<string>(tool);
  const colorSV = useSharedValue<string>(color);
  const sizeSV = useSharedValue<number>(size);
  const shapeSV = useSharedValue<string>(shape);
  const stylusOnlySV = useSharedValue<boolean>(stylusOnly);
  useEffect(() => {
    toolSV.value = tool;
    colorSV.value = color;
    sizeSV.value = size;
    shapeSV.value = shape;
    stylusOnlySV.value = stylusOnly;
  }, [tool, color, size, shape, stylusOnly]);

  // ---- live drawing state ---------------------------------------------------
  // mode: 0 none, 1 stroke, 2 shape, 3 erase, 4 text tap, 5 navigate,
  //       6 lasso / tap-select, 7 move selection, 8 scale selection, 10 move ruler
  const mode = useSharedValue(0);
  const liveVisible = useSharedValue(0);
  const serial = useSharedValue(0);
  const livePage = useSharedValue(-1);
  const liveOx = useSharedValue(0);
  const liveOy = useSharedValue(0);
  const livePts = useSharedValue<number[]>([]);
  const filt = useSharedValue<number[]>(newFilterState());
  const prs = useSharedValue(0.5);
  const liveParams = useSharedValue<number[]>([2, 0, 1, 1, 1, 0, 0]); // size,gain,minFrac,opacity,cutoff,beta,stylus
  const liveColor = useSharedValue('#000000');
  const liveOpacity = useSharedValue(1);
  const liveShape = useSharedValue('line');
  const sx1 = useSharedValue(0);
  const sy1 = useSharedValue(0);
  const sx2 = useSharedValue(0);
  const sy2 = useSharedValue(0);
  const navStart = useSharedValue<number[]>([0, 0]);
  const pinchStart = useSharedValue<number[]>([1, 0, 0, 0, 0]);
  const eraseLast = useSharedValue<number[]>([-999, -999]);
  const eraserOn = useSharedValue(0);
  const erX = useSharedValue(0);
  const erY = useSharedValue(0);
  const erR = useSharedValue(10);
  // hold-to-snap
  const snapped = useSharedValue(0); // 0 waiting, 1 snapped, -1 tried and failed
  const snapKind = useSharedValue(0); // 0 none, 1 line, 2 ellipse, 3 rect
  const lastMoveT = useSharedValue(0);
  const lastMoveXY = useSharedValue<number[]>([0, 0]);
  // selection
  const selActive = useSharedValue(0);
  const selPage = useSharedValue(-1);
  const selBase = useSharedValue<number[]>([0, 0, 0, 0]);
  const selM = useSharedValue<number[]>([1, 0, 0]); // cumulative: p' = s*p + t
  const selInc = useSharedValue<number[]>([1, 0, 0, 0, 0]); // live: [s2, ax, ay, dx, dy]
  const selStart = useSharedValue<number[]>([0, 0, 0, 0, 1]);
  // ruler
  const rulerOnSV = useSharedValue(0);
  const rcx = useSharedValue(200);
  const rcy = useSharedValue(200);
  const rang = useSharedValue(0);
  const rotStart = useSharedValue(0);
  const rulerGesture = useSharedValue(0);
  const rulerEdge = useSharedValue(0);

  // ---- layout bookkeeping ---------------------------------------------------
  const [range, setRange] = useState({ first: 0, last: 1 });

  const clampTx = (v: number, s: number) => {
    'worklet';
    const cw = contentW.value * s;
    const vw = viewW.value;
    if (cw <= vw) return (vw - cw) / 2;
    return Math.min(0, Math.max(vw - cw, v));
  };
  const clampTy = (v: number, s: number) => {
    'worklet';
    const ch = contentH.value * s;
    const vh = viewH.value;
    if (ch <= vh) return 0;
    return Math.min(0, Math.max(vh - ch, v));
  };

  useEffect(() => {
    layoutSV.value = layout.flat;
    contentW.value = layout.contentW;
    contentH.value = layout.contentH;
    if (viewW.value > 0) {
      sc.value = Math.max(sc.value, 0.01);
      tx.value = clampTx(tx.value, sc.value);
      ty.value = clampTy(ty.value, sc.value);
    }
  }, [layout]);

  const onLayout = useCallback(
    (e: LayoutChangeEvent) => {
      const { width, height } = e.nativeEvent.layout;
      const first = inited.value === 0;
      const widthChanged = Math.abs(width - viewW.value) > 1;
      viewW.value = width;
      viewH.value = height;
      if (first || widthChanged) {
        const s = width / contentW.value;
        sc.value = s;
        tx.value = clampTx(0, s);
        ty.value = first ? 0 : clampTy(ty.value, s);
        inited.value = 1;
        rcx.value = width / 2;
        rcy.value = height * 0.35;
      } else {
        ty.value = clampTy(ty.value, sc.value);
      }
    },
    [layout]
  );

  // fit / goto requests
  useEffect(() => {
    if (!props.fitNonce) return;
    const s = viewW.value > 0 ? viewW.value / contentW.value : 1;
    sc.value = withTiming(s, { duration: 180 });
    tx.value = withTiming(clampTx(0, s), { duration: 180 });
    ty.value = withTiming(clampTy(ty.value, s), { duration: 180 });
  }, [props.fitNonce]);

  useEffect(() => {
    const g = props.gotoRequest;
    if (!g) return;
    const L = layoutSV.value;
    if (g.page < 0 || g.page * 4 + 3 >= L.length) return;
    const s = sc.value;
    cancelAnimation(ty);
    const target = clampTy(-(L[g.page * 4 + 1] - MARGIN) * s, s);
    if (g.instant) ty.value = target;
    else ty.value = withTiming(target, { duration: 220 });
  }, [props.gotoRequest?.nonce]);

  // selection snapshot -> shared values
  useEffect(() => {
    selM.value = [1, 0, 0];
    selInc.value = [1, 0, 0, 0, 0];
    if (selection) {
      const b = selection.bounds;
      selBase.value = [b.x0, b.y0, b.x1, b.y1];
      selPage.value = selection.pageIndex;
      selActive.value = 1;
    } else {
      selActive.value = 0;
      selPage.value = -1;
    }
  }, [selection]);

  // ruler on/off
  useEffect(() => {
    rulerOnSV.value = rulerOn ? 1 : 0;
    if (rulerOn && viewW.value > 0) {
      rcx.value = viewW.value / 2;
      rcy.value = viewH.value * 0.35;
      rang.value = 0;
    }
  }, [rulerOn]);

  const notifyPage = useCallback((i: number) => cb.current.onCurrentPage(i), []);

  // visible page range + current page
  useAnimatedReaction(
    () => {
      const L = layoutSV.value;
      const s = sc.value;
      if (s <= 0 || viewH.value <= 0) return 0;
      const top = -ty.value / s;
      const bottom = top + viewH.value / s;
      const buffer = (viewH.value / s) * 0.6;
      const n = L.length / 4;
      let first = -1;
      let last = -1;
      let center = 0;
      const mid = (top + bottom) / 2;
      let bestD = 1e12;
      for (let i = 0; i < n; i++) {
        const py = L[i * 4 + 1];
        const ph = L[i * 4 + 3];
        if (py + ph >= top - buffer && py <= bottom + buffer) {
          if (first < 0) first = i;
          last = i;
        }
        const d = Math.abs(py + ph / 2 - mid);
        if (d < bestD) {
          bestD = d;
          center = i;
        }
      }
      if (first < 0) {
        first = 0;
        last = 0;
      }
      return first * 1e8 + last * 1e4 + center;
    },
    (key, prev) => {
      if (key === prev) return;
      const first = Math.floor(key / 1e8);
      const last = Math.floor((key % 1e8) / 1e4);
      const center = key % 1e4;
      runOnJS(setRange)({ first, last });
      runOnJS(notifyPage)(center);
    },
    []
  );

  // ---- JS callbacks ---------------------------------------------------------
  const clearLiveIfSame = useCallback((s: number) => {
    if (serial.value === s) {
      liveVisible.value = 0;
      livePts.value = [];
    }
  }, []);

  const jsAddStroke = useCallback(
    (page: number, toolName: string, col: string, sz: number, pts: number[], s: number) => {
      const rounded = pts.map((v, i) => (i % 3 === 2 ? Math.round(v * 100) / 100 : Math.round(v * 10) / 10));
      const item: StrokeItem = {
        id: uid(),
        k: 's',
        tool: toolName as InkTool,
        color: col,
        size: sz,
        pts: rounded,
      };
      cb.current.onAddItem(page, item);
      requestAnimationFrame(() => requestAnimationFrame(() => clearLiveIfSame(s)));
    },
    []
  );

  const jsAddShape = useCallback(
    (
      page: number,
      kind: string,
      col: string,
      sz: number,
      x1: number,
      y1: number,
      x2: number,
      y2: number,
      s: number,
      fromTool: string
    ) => {
      const item: ShapeItem = {
        id: uid(),
        k: 'h',
        shape: kind as ShapeKind,
        color: col,
        size: sz,
        x1: Math.round(x1 * 10) / 10,
        y1: Math.round(y1 * 10) / 10,
        x2: Math.round(x2 * 10) / 10,
        y2: Math.round(y2 * 10) / 10,
      };
      if (fromTool) item.tool = fromTool as InkTool;
      cb.current.onAddItem(page, item);
      requestAnimationFrame(() => requestAnimationFrame(() => clearLiveIfSame(s)));
    },
    []
  );

  const jsErase = useCallback((page: number, x: number, y: number, r: number) => cb.current.onEraseAt(page, x, y, r), []);
  const jsEraseEnd = useCallback(() => cb.current.onEraseEnd(), []);
  const jsTextTap = useCallback((page: number, x: number, y: number) => cb.current.onTextTap(page, x, y), []);
  const jsSelectTap = useCallback((page: number, x: number, y: number) => cb.current.onSelectTap(page, x, y), []);
  const jsLasso = useCallback((page: number, poly: number[]) => cb.current.onLasso(page, poly), []);
  const jsSelTransform = useCallback(
    (s: number, tx2: number, ty2: number) => cb.current.onSelectionTransform(s, tx2, ty2),
    []
  );

  // ---- worklet helpers ------------------------------------------------------
  const pageAt = (cx: number, cy: number) => {
    'worklet';
    const L = layoutSV.value;
    const n = L.length / 4;
    for (let i = 0; i < n; i++) {
      const x = L[i * 4];
      const y = L[i * 4 + 1];
      if (cx >= x && cx <= x + L[i * 4 + 2] && cy >= y - GAP / 2 && cy <= y + L[i * 4 + 3] + GAP / 2) return i;
    }
    return -1;
  };

  const rulerLen = () => {
    'worklet';
    return Math.min(viewW.value * 0.85, 1000);
  };

  const inRuler = (x: number, y: number) => {
    'worklet';
    if (rulerOnSV.value === 0) return false;
    const dx = x - rcx.value;
    const dy = y - rcy.value;
    const c = Math.cos(rang.value);
    const s = Math.sin(rang.value);
    const lx = dx * c + dy * s;
    const ly = -dx * s + dy * c;
    return Math.abs(lx) <= rulerLen() / 2 && Math.abs(ly) <= RULER_TH / 2;
  };

  /** Projects a screen point onto the ruler edge chosen when the stroke began. */
  const snapToRuler = (x: number, y: number) => {
    'worklet';
    const edge = rulerEdge.value;
    if (edge === 0) return [x, y];
    const dx = x - rcx.value;
    const dy = y - rcy.value;
    const c = Math.cos(rang.value);
    const s = Math.sin(rang.value);
    let lx = dx * c + dy * s;
    const half = rulerLen() / 2;
    if (lx > half) lx = half;
    if (lx < -half) lx = -half;
    const ly = edge * (RULER_TH / 2);
    return [rcx.value + lx * c - ly * s, rcy.value + lx * s + ly * c];
  };

  const addStrokePoint = (x: number, y: number, rawPressure: number, stylus: boolean) => {
    'worklet';
    const lp = liveParams.value;
    const f = filt.value.slice();
    const lastT = f[4];
    const px = f[0];
    const py = f[1];
    const wasInit = f[5] === 1;
    const now = Date.now();
    oneEuroStep(f, x, y, now, lp[4], lp[5]);
    filt.value = f;
    let fx = f[0];
    let fy = f[1];
    if (rulerEdge.value !== 0) {
      const q = snapToRuler(fx, fy);
      fx = q[0];
      fy = q[1];
    }
    // movement tracking for "hold to snap"
    const lm = lastMoveXY.value;
    const mdx = fx - lm[0];
    const mdy = fy - lm[1];
    if (mdx * mdx + mdy * mdy > 9) {
      lastMoveXY.value = [fx, fy];
      lastMoveT.value = now;
      if (snapped.value === -1) snapped.value = 0;
    }
    let p = prs.value;
    if (stylus && rawPressure >= 0) {
      p = stylusPressure(p, rawPressure);
    } else {
      let dt = (now - lastT) / 1000;
      if (dt < 0.004) dt = 0.004;
      const speed = wasInit ? Math.sqrt((f[0] - px) * (f[0] - px) + (f[1] - py) * (f[1] - py)) / dt : 0;
      p = simulatePressure(p, speed);
    }
    prs.value = p;
    const s = sc.value;
    const cx = (fx - tx.value) / s - liveOx.value;
    const cy = (fy - ty.value) / s - liveOy.value;
    livePts.modify((arr) => {
      'worklet';
      arr.push(cx, cy, p);
      return arr;
    });
  };

  // hold the pen still ~0.5s at the end of a stroke -> straight line / ellipse / rectangle
  useFrameCallback(() => {
    'worklet';
    if (mode.value !== 1 || snapped.value !== 0) return;
    if (Date.now() - lastMoveT.value < 550) return;
    const pts = livePts.value;
    if (pts.length < 24) return;
    const r = recognizeShape(pts);
    if (r[0] === 0) {
      snapped.value = -1;
      return;
    }
    snapped.value = 1;
    snapKind.value = r[0];
    liveShape.value = r[0] === 1 ? 'line' : r[0] === 2 ? 'ellipse' : 'rect';
    sx1.value = r[1];
    sy1.value = r[2];
    sx2.value = r[3];
    sy2.value = r[4];
    mode.value = 2;
  });

  // ---- gestures -------------------------------------------------------------
  const gesture = useMemo(() => {
    const pan = Gesture.Pan()
      .minDistance(0)
      .maxPointers(1)
      .shouldCancelWhenOutside(false)
      .onStart((e) => {
        'worklet';
        cancelAnimation(tx);
        cancelAnimation(ty);
        const stylus = e.stylusData !== undefined;

        // the ruler body always moves (finger or pen)
        if (inRuler(e.x, e.y)) {
          mode.value = 10;
          navStart.value = [rcx.value, rcy.value];
          return;
        }

        const t = toolSV.value;
        let m = 0;
        if (t === 'hand') m = 5;
        else if (stylusOnlySV.value && !stylus) m = 5;
        else if (t === 'pen' || t === 'fountain' || t === 'pencil' || t === 'highlighter') m = 1;
        else if (t === 'shape') m = 2;
        else if (t === 'eraser') m = 3;
        else if (t === 'text') m = 4;
        else if (t === 'select') m = 6;

        if (m === 5) {
          mode.value = 5;
          navStart.value = [tx.value, ty.value];
          return;
        }
        const s = sc.value;
        const cx = (e.x - tx.value) / s;
        const cy = (e.y - ty.value) / s;
        const idx = pageAt(cx, cy);
        if (idx < 0) {
          mode.value = 0;
          return;
        }
        const L = layoutSV.value;
        serial.value = serial.value + 1;
        livePage.value = idx;
        liveOx.value = L[idx * 4];
        liveOy.value = L[idx * 4 + 1];
        mode.value = m;

        if (m === 1) {
          const nums = PRESET_NUMS[t];
          liveParams.value = [
            sizeSV.value,
            nums[0],
            nums[1],
            nums[2],
            stylus ? nums[5] : nums[3],
            stylus ? nums[6] : nums[4],
            stylus ? 1 : 0,
          ];
          liveColor.value = colorSV.value;
          liveOpacity.value = nums[2];
          livePts.value = [];
          filt.value = newFilterState();
          prs.value = stylus ? 0.5 : 0.6;
          snapped.value = 0;
          snapKind.value = 0;
          lastMoveXY.value = [e.x, e.y];
          lastMoveT.value = Date.now();
          // ruler: remember which edge the stroke started next to
          rulerEdge.value = 0;
          if (rulerOnSV.value === 1) {
            const dx = e.x - rcx.value;
            const dy = e.y - rcy.value;
            const c = Math.cos(rang.value);
            const sn = Math.sin(rang.value);
            const lx = dx * c + dy * sn;
            const ly = -dx * sn + dy * c;
            if (Math.abs(lx) <= rulerLen() / 2 + 24) {
              if (Math.abs(ly - RULER_TH / 2) < 30) rulerEdge.value = 1;
              else if (Math.abs(ly + RULER_TH / 2) < 30) rulerEdge.value = -1;
            }
          }
          liveVisible.value = 1;
          addStrokePoint(e.x, e.y, e.stylusData ? e.stylusData.pressure : -1, stylus);
        } else if (m === 2) {
          liveParams.value = [sizeSV.value, 0, 1, 1, 1, 0, 0];
          liveColor.value = colorSV.value;
          liveOpacity.value = 1;
          liveShape.value = shapeSV.value;
          snapKind.value = 0;
          sx1.value = cx - liveOx.value;
          sy1.value = cy - liveOy.value;
          sx2.value = sx1.value;
          sy2.value = sy1.value;
          liveVisible.value = 1;
        } else if (m === 3) {
          eraseLast.value = [-999, -999];
          eraserOn.value = 1;
        } else if (m === 6) {
          if (selActive.value === 1) {
            const sp = selPage.value;
            const lx = cx - L[sp * 4];
            const ly = cy - L[sp * 4 + 1];
            const M = selM.value;
            const b = selBase.value;
            const x0 = M[0] * b[0] + M[1];
            const y0 = M[0] * b[1] + M[2];
            const x1 = M[0] * b[2] + M[1];
            const y1 = M[0] * b[3] + M[2];
            const hr = 30 / s;
            let hit = 0;
            let ax = 0;
            let ay = 0;
            if (Math.abs(lx - x1) < hr && Math.abs(ly - y1) < hr) {
              hit = 1;
              ax = x0;
              ay = y0;
            } else if (Math.abs(lx - x0) < hr && Math.abs(ly - y0) < hr) {
              hit = 1;
              ax = x1;
              ay = y1;
            } else if (Math.abs(lx - x1) < hr && Math.abs(ly - y0) < hr) {
              hit = 1;
              ax = x0;
              ay = y1;
            } else if (Math.abs(lx - x0) < hr && Math.abs(ly - y1) < hr) {
              hit = 1;
              ax = x1;
              ay = y0;
            }
            if (hit === 1) {
              const d0 = Math.sqrt((lx - ax) * (lx - ax) + (ly - ay) * (ly - ay));
              selStart.value = [lx, ly, ax, ay, Math.max(8, d0)];
              selInc.value = [1, ax, ay, 0, 0];
              mode.value = 8;
              return;
            }
            const pad = 8 / s;
            if (lx >= x0 - pad && lx <= x1 + pad && ly >= y0 - pad && ly <= y1 + pad) {
              selInc.value = [1, 0, 0, 0, 0];
              mode.value = 7;
              return;
            }
          }
          livePts.value = [cx - liveOx.value, cy - liveOy.value, 1];
          liveVisible.value = 1;
        }
      })
      .onUpdate((e) => {
        'worklet';
        const m = mode.value;
        if (m === 1) {
          addStrokePoint(e.x, e.y, e.stylusData ? e.stylusData.pressure : -1, e.stylusData !== undefined);
        } else if (m === 2) {
          const k = snapKind.value;
          if (k === 0 || k === 1) {
            const s = sc.value;
            sx2.value = (e.x - tx.value) / s - liveOx.value;
            sy2.value = (e.y - ty.value) / s - liveOy.value;
          }
        } else if (m === 3) {
          const s = sc.value;
          const cx = (e.x - tx.value) / s;
          const cy = (e.y - ty.value) / s;
          erX.value = cx;
          erY.value = cy;
          const r = sizeSV.value * 0.5 + 6 / s;
          erR.value = r;
          const last = eraseLast.value;
          const dx = e.x - last[0];
          const dy = e.y - last[1];
          if (dx * dx + dy * dy >= 2) {
            eraseLast.value = [e.x, e.y];
            const idx = pageAt(cx, cy);
            if (idx >= 0) {
              const L = layoutSV.value;
              runOnJS(jsErase)(idx, cx - L[idx * 4], cy - L[idx * 4 + 1], r);
            }
          }
        } else if (m === 5) {
          const st = navStart.value;
          const s = sc.value;
          tx.value = clampTx(st[0] + e.translationX, s);
          ty.value = clampTy(st[1] + e.translationY, s);
        } else if (m === 6) {
          const s = sc.value;
          const x = (e.x - tx.value) / s - liveOx.value;
          const y = (e.y - ty.value) / s - liveOy.value;
          livePts.modify((arr) => {
            'worklet';
            arr.push(x, y, 1);
            return arr;
          });
        } else if (m === 7) {
          const s = sc.value;
          selInc.value = [1, 0, 0, e.translationX / s, e.translationY / s];
        } else if (m === 8) {
          const s = sc.value;
          const st = selStart.value;
          const L = layoutSV.value;
          const sp = selPage.value;
          const lx = (e.x - tx.value) / s - L[sp * 4];
          const ly = (e.y - ty.value) / s - L[sp * 4 + 1];
          const d = Math.sqrt((lx - st[2]) * (lx - st[2]) + (ly - st[3]) * (ly - st[3]));
          let s2 = d / st[4];
          if (s2 < 0.15) s2 = 0.15;
          if (s2 > 8) s2 = 8;
          selInc.value = [s2, st[2], st[3], 0, 0];
        } else if (m === 10) {
          const st = navStart.value;
          rcx.value = st[0] + e.translationX;
          rcy.value = st[1] + e.translationY;
        }
      })
      .onEnd((e, success) => {
        'worklet';
        const m = mode.value;
        if (!success) return;
        if (m === 1) {
          const pts = livePts.value;
          if (pts.length >= 3) {
            runOnJS(jsAddStroke)(livePage.value, toolSV.value, liveColor.value, liveParams.value[0], pts.slice(), serial.value);
          } else {
            liveVisible.value = 0;
          }
        } else if (m === 2) {
          const dx = sx2.value - sx1.value;
          const dy = sy2.value - sy1.value;
          if (dx * dx + dy * dy > 16) {
            runOnJS(jsAddShape)(
              livePage.value,
              liveShape.value,
              liveColor.value,
              liveParams.value[0],
              sx1.value,
              sy1.value,
              sx2.value,
              sy2.value,
              serial.value,
              snapKind.value > 0 ? toolSV.value : ''
            );
          } else {
            liveVisible.value = 0;
          }
        } else if (m === 3) {
          eraserOn.value = 0;
          runOnJS(jsEraseEnd)();
        } else if (m === 4) {
          if (e.translationX * e.translationX + e.translationY * e.translationY < 144) {
            const s = sc.value;
            const cx = (e.x - tx.value) / s;
            const cy = (e.y - ty.value) / s;
            const idx = pageAt(cx, cy);
            if (idx >= 0) {
              const L = layoutSV.value;
              runOnJS(jsTextTap)(idx, cx - L[idx * 4], cy - L[idx * 4 + 1]);
            }
          }
        } else if (m === 5) {
          const s = sc.value;
          const ch = contentH.value * s;
          const cw = contentW.value * s;
          if (ch > viewH.value) {
            ty.value = withDecay({ velocity: e.velocityY, clamp: [viewH.value - ch, 0] });
          }
          if (cw > viewW.value) {
            tx.value = withDecay({ velocity: e.velocityX, clamp: [viewW.value - cw, 0] });
          }
        } else if (m === 6) {
          const pts = livePts.value;
          if (e.translationX * e.translationX + e.translationY * e.translationY < 100 || pts.length < 12) {
            runOnJS(jsSelectTap)(livePage.value, pts[0], pts[1]);
          } else {
            const poly: number[] = [];
            for (let i = 0; i + 1 < pts.length; i += 3) poly.push(pts[i], pts[i + 1]);
            runOnJS(jsLasso)(livePage.value, poly);
          }
          liveVisible.value = 0;
          livePts.value = [];
        } else if (m === 7 || m === 8) {
          const M = selM.value;
          const inc = selInc.value;
          const s2 = inc[0];
          const ns = s2 * M[0];
          const ntx = s2 * M[1] + (inc[1] - s2 * inc[1] + inc[3]);
          const nty = s2 * M[2] + (inc[2] - s2 * inc[2] + inc[4]);
          const moved = Math.abs(s2 - 1) > 0.001 || Math.abs(inc[3]) > 0.3 || Math.abs(inc[4]) > 0.3;
          selM.value = [ns, ntx, nty];
          selInc.value = [1, 0, 0, 0, 0];
          if (moved) runOnJS(jsSelTransform)(ns, ntx, nty);
        }
      })
      .onFinalize((_e, success) => {
        'worklet';
        if (!success) {
          const m = mode.value;
          // cancelled (second finger landed, system gesture, ...): drop the unfinished work
          if (m === 1 || m === 2 || m === 6) {
            liveVisible.value = 0;
            livePts.value = [];
          }
          if (m === 7 || m === 8) selInc.value = [1, 0, 0, 0, 0];
          if (m === 3) {
            eraserOn.value = 0;
            runOnJS(jsEraseEnd)();
          }
        }
      });

    const pinch = Gesture.Pinch()
      .onStart((e) => {
        'worklet';
        cancelAnimation(tx);
        cancelAnimation(ty);
        cancelAnimation(sc);
        rulerGesture.value = inRuler(e.focalX, e.focalY) ? 1 : 0;
        // a second finger means "navigate": discard any unfinished stroke
        const m = mode.value;
        if (m === 1 || m === 2 || m === 6) {
          liveVisible.value = 0;
          livePts.value = [];
        }
        if (m === 7 || m === 8) selInc.value = [1, 0, 0, 0, 0];
        if (m === 3) {
          eraserOn.value = 0;
          runOnJS(jsEraseEnd)();
        }
        mode.value = 0;
        pinchStart.value = [sc.value, tx.value, ty.value, e.focalX, e.focalY];
      })
      .onUpdate((e) => {
        'worklet';
        if (rulerGesture.value === 1) return;
        const st = pinchStart.value;
        const fit = viewW.value / contentW.value;
        const minS = fit * 0.6;
        const maxS = fit * 6;
        let ns = st[0] * e.scale;
        if (ns < minS) ns = minS;
        if (ns > maxS) ns = maxS;
        const ratio = ns / st[0];
        const ntx = e.focalX - (st[3] - st[1]) * ratio;
        const nty = e.focalY - (st[4] - st[2]) * ratio;
        sc.value = ns;
        tx.value = clampTx(ntx, ns);
        ty.value = clampTy(nty, ns);
      })
      .onEnd(() => {
        'worklet';
        if (rulerGesture.value === 1) return;
        const fit = viewW.value / contentW.value;
        if (sc.value < fit) {
          // snap back to fit width when zoomed out
          sc.value = withTiming(fit, { duration: 160 });
          tx.value = withTiming(clampTx(0, fit), { duration: 160 });
          ty.value = withTiming(clampTy(ty.value, fit), { duration: 160 });
        }
      });

    // two fingers rotating on top of the ruler turn the ruler
    const rotate = Gesture.Rotation()
      .onStart((e) => {
        'worklet';
        rulerGesture.value = inRuler(e.anchorX, e.anchorY) ? 1 : 0;
        rotStart.value = rang.value;
      })
      .onUpdate((e) => {
        'worklet';
        if (rulerGesture.value === 1) rang.value = rotStart.value + e.rotation;
      });

    return Gesture.Simultaneous(pan, pinch, rotate);
  }, []);

  // ---- derived render values ------------------------------------------------
  const contentTransform = useDerivedValue(() => [
    { translateX: tx.value },
    { translateY: ty.value },
    { scale: sc.value },
  ]);

  const livePath = useDerivedValue(() => {
    const path = Skia.Path.Make();
    if (liveVisible.value === 0) return path;
    const lp = liveParams.value;
    if (mode.value === 1) {
      appendPoly(path, buildOutline(livePts.value, lp[0], lp[1], lp[2]), liveOx.value, liveOy.value);
    } else if (mode.value === 2) {
      const polys = shapeOutlines(liveShape.value as ShapeKind, sx1.value, sy1.value, sx2.value, sy2.value, lp[0]);
      for (let i = 0; i < polys.length; i++) appendPoly(path, polys[i], liveOx.value, liveOy.value);
    }
    return path;
  });

  const lassoPath = useDerivedValue(() => {
    const path = Skia.Path.Make();
    if (liveVisible.value === 0 || mode.value !== 6) return path;
    const pts = livePts.value;
    const n = pts.length / 3;
    if (n < 2) return path;
    path.moveTo(pts[0] + liveOx.value, pts[1] + liveOy.value);
    for (let i = 1; i < n; i++) path.lineTo(pts[i * 3] + liveOx.value, pts[i * 3 + 1] + liveOy.value);
    path.close();
    return path;
  });
  const lassoStroke = useDerivedValue(() => 1.6 / sc.value);
  const eraserStroke = useDerivedValue(() => 1.5 / sc.value);

  // selection overlay: cumulative matrix composed with the live (in-gesture) matrix
  const selTransform = useDerivedValue(() => {
    const M = selM.value;
    const inc = selInc.value;
    const s2 = inc[0];
    const s = s2 * M[0];
    const t1 = s2 * M[1] + (inc[1] - s2 * inc[1] + inc[3]);
    const t2 = s2 * M[2] + (inc[2] - s2 * inc[2] + inc[4]);
    const L = layoutSV.value;
    const p = selPage.value;
    const ox = p >= 0 && p * 4 < L.length ? L[p * 4] : 0;
    const oy = p >= 0 && p * 4 < L.length ? L[p * 4 + 1] : 0;
    return [{ translateX: ox + t1 }, { translateY: oy + t2 }, { scale: s }];
  });
  const selTotalScale = useDerivedValue(() => sc.value * selInc.value[0] * selM.value[0]);
  const selStroke = useDerivedValue(() => 1.6 / selTotalScale.value);
  const handleR = useDerivedValue(() => 9 / selTotalScale.value);
  const handleStroke = useDerivedValue(() => 2 / selTotalScale.value);

  const selPic = useMemo(() => {
    if (!selection) return null;
    const pg = pages[selection.pageIndex];
    if (!pg) return null;
    return createItemsPicture(selection.items, pg.w, pg.h, docId);
  }, [selection]); // eslint-disable-line react-hooks/exhaustive-deps

  // ruler (screen space)
  const rulerTransform = useDerivedValue(() => [
    { translateX: rcx.value },
    { translateY: rcy.value },
    { rotate: rang.value },
  ]);
  const rulerX = useDerivedValue(() => -rulerLen() / 2);
  const rulerW = useDerivedValue(() => rulerLen());
  const rulerTicks = useDerivedValue(() => {
    const path = Skia.Path.Make();
    const step = 28.346 * sc.value; // 1 cm in page units
    const half = rulerLen() / 2;
    if (step < 7) return path;
    const kmax = Math.floor(half / step);
    for (let k = -kmax; k <= kmax; k++) {
      const x = k * step;
      const hh = k % 5 === 0 ? 16 : 9;
      path.moveTo(x, RULER_TH / 2);
      path.lineTo(x, RULER_TH / 2 - hh);
      path.moveTo(x, -RULER_TH / 2);
      path.lineTo(x, -RULER_TH / 2 + hh);
    }
    return path;
  });

  const visible = useMemo(() => {
    const out: React.ReactNode[] = [];
    const last = Math.min(range.last, pages.length - 1);
    const hidden = selection ? selection.items.map((it) => it.id) : undefined;
    for (let i = Math.max(0, range.first); i <= last; i++) {
      const L = layout.flat;
      out.push(
        <PageLayer
          key={pages[i].id}
          docId={docId}
          page={pages[i]}
          x={L[i * 4]}
          y={L[i * 4 + 1]}
          hiddenIds={selection && selection.pageIndex === i ? hidden : undefined}
        />
      );
    }
    return out;
  }, [range, pages, layout, docId, selection]);

  const sb = selection?.bounds;

  return (
    <GestureDetector gesture={gesture}>
      <View style={[styles.fill, { backgroundColor: theme.canvasBg }]} onLayout={onLayout} collapsable={false}>
        <Canvas style={StyleSheet.absoluteFill}>
          <Group transform={contentTransform}>
            {visible}
            <Path
              path={livePath}
              color={liveColor}
              opacity={liveOpacity}
              blendMode={tool === 'highlighter' ? 'multiply' : 'srcOver'}
            />
            <Path path={lassoPath} style="stroke" strokeWidth={lassoStroke} color="#4F46E5">
              <DashPathEffect intervals={[10, 7]} />
            </Path>
            <Circle cx={erX} cy={erY} r={erR} style="stroke" strokeWidth={eraserStroke} color="#5C6BC0" opacity={eraserOn} />
            {selection && sb ? (
              <Group transform={selTransform}>
                {selPic ? <Picture picture={selPic} /> : null}
                <Rect
                  x={sb.x0 - 3}
                  y={sb.y0 - 3}
                  width={sb.x1 - sb.x0 + 6}
                  height={sb.y1 - sb.y0 + 6}
                  style="stroke"
                  strokeWidth={selStroke}
                  color="#4F46E5"
                >
                  <DashPathEffect intervals={[8, 5]} />
                </Rect>
                {[
                  [sb.x0 - 3, sb.y0 - 3],
                  [sb.x1 + 3, sb.y0 - 3],
                  [sb.x0 - 3, sb.y1 + 3],
                  [sb.x1 + 3, sb.y1 + 3],
                ].map((c, i) => (
                  <Group key={i}>
                    <Circle cx={c[0]} cy={c[1]} r={handleR} color="#FFFFFF" />
                    <Circle cx={c[0]} cy={c[1]} r={handleR} style="stroke" strokeWidth={handleStroke} color="#4F46E5" />
                  </Group>
                ))}
              </Group>
            ) : null}
          </Group>
          {rulerOn ? (
            <Group transform={rulerTransform}>
              <RoundedRect x={rulerX} y={-RULER_TH / 2} width={rulerW} height={RULER_TH} r={10} color="rgba(79,70,229,0.26)" />
              <RoundedRect
                x={rulerX}
                y={-RULER_TH / 2}
                width={rulerW}
                height={RULER_TH}
                r={10}
                style="stroke"
                strokeWidth={1.5}
                color="#4F46E5"
              />
              <Path path={rulerTicks} style="stroke" strokeWidth={1.2} color="#312E81" />
            </Group>
          ) : null}
        </Canvas>
      </View>
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, overflow: 'hidden' },
});
