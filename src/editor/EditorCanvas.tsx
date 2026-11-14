import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { LayoutChangeEvent, StyleSheet, View } from 'react-native';
import { Canvas, Circle, Group, Path, Skia } from '@shopify/react-native-skia';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import {
  cancelAnimation,
  runOnJS,
  useAnimatedReaction,
  useDerivedValue,
  useSharedValue,
  withDecay,
  withTiming,
} from 'react-native-reanimated';
import {
  buildOutline,
  newFilterState,
  oneEuroStep,
  shapeOutlines,
  simulatePressure,
  stylusPressure,
  type ShapeKind,
} from '../ink/engine';
import { appendPoly } from '../ink/render';
import { PRESETS } from '../tools';
import { theme } from '../theme';
import type { Page, ShapeItem, StrokeItem, ToolId } from '../types';
import { uid } from '../services/storage';
import { PageLayer } from './PageLayer';

const MARGIN = 10;
const GAP = 14;

// presets as plain numbers so worklets can capture them
const PRESET_NUMS: Record<string, number[]> = {};
(Object.keys(PRESETS) as (keyof typeof PRESETS)[]).forEach((k) => {
  const p = PRESETS[k];
  PRESET_NUMS[k] = [p.gain, p.minFrac, p.opacity, p.fingerCutoff, p.fingerBeta, p.penCutoff, p.penBeta];
});

export type GotoRequest = { page: number; nonce: number };

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
  onAddItem: (pageIndex: number, item: StrokeItem | ShapeItem) => void;
  onEraseAt: (pageIndex: number, x: number, y: number, r: number) => void;
  onEraseEnd: () => void;
  onTextTap: (pageIndex: number, x: number, y: number) => void;
  onCurrentPage: (index: number) => void;
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
  const { docId, pages, tool, color, size, shape, stylusOnly } = props;
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
  const mode = useSharedValue(0); // 0 none, 1 stroke, 2 shape, 3 erase, 4 text tap, 5 navigate
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
    ty.value = withTiming(clampTy(-(L[g.page * 4 + 1] - MARGIN) * s, s), { duration: 220 });
  }, [props.gotoRequest?.nonce]);

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
        tool: toolName as StrokeItem['tool'],
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
    (page: number, kind: string, col: string, sz: number, x1: number, y1: number, x2: number, y2: number, s: number) => {
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
      cb.current.onAddItem(page, item);
      requestAnimationFrame(() => requestAnimationFrame(() => clearLiveIfSame(s)));
    },
    []
  );

  const jsErase = useCallback((page: number, x: number, y: number, r: number) => cb.current.onEraseAt(page, x, y, r), []);
  const jsEraseEnd = useCallback(() => cb.current.onEraseEnd(), []);
  const jsTextTap = useCallback((page: number, x: number, y: number) => cb.current.onTextTap(page, x, y), []);

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
    const cx = (f[0] - tx.value) / s - liveOx.value;
    const cy = (f[1] - ty.value) / s - liveOy.value;
    livePts.modify((arr) => {
      'worklet';
      arr.push(cx, cy, p);
      return arr;
    });
  };

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
        const t = toolSV.value;
        let m = 0;
        if (t === 'hand') m = 5;
        else if (stylusOnlySV.value && !stylus) m = 5;
        else if (t === 'pen' || t === 'fountain' || t === 'pencil' || t === 'highlighter') m = 1;
        else if (t === 'shape') m = 2;
        else if (t === 'eraser') m = 3;
        else if (t === 'text') m = 4;

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
          liveVisible.value = 1;
          addStrokePoint(e.x, e.y, e.stylusData ? e.stylusData.pressure : -1, stylus);
        } else if (m === 2) {
          liveParams.value = [sizeSV.value, 0, 1, 1, 1, 0, 0];
          liveColor.value = colorSV.value;
          liveOpacity.value = 1;
          liveShape.value = shapeSV.value;
          sx1.value = cx - liveOx.value;
          sy1.value = cy - liveOy.value;
          sx2.value = sx1.value;
          sy2.value = sy1.value;
          liveVisible.value = 1;
        } else if (m === 3) {
          eraseLast.value = [-999, -999];
          eraserOn.value = 1;
        }
      })
      .onUpdate((e) => {
        'worklet';
        const m = mode.value;
        if (m === 1) {
          addStrokePoint(e.x, e.y, e.stylusData ? e.stylusData.pressure : -1, e.stylusData !== undefined);
        } else if (m === 2) {
          const s = sc.value;
          sx2.value = (e.x - tx.value) / s - liveOx.value;
          sy2.value = (e.y - ty.value) / s - liveOy.value;
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
              serial.value
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
        }
      })
      .onFinalize((_e, success) => {
        'worklet';
        if (!success) {
          // cancelled (second finger landed, system gesture, ...): drop the unfinished stroke
          if (mode.value === 1 || mode.value === 2) {
            liveVisible.value = 0;
            livePts.value = [];
          }
          if (mode.value === 3) {
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
        // a second finger means "navigate": discard any unfinished stroke
        if (mode.value === 1 || mode.value === 2) {
          liveVisible.value = 0;
          livePts.value = [];
        }
        if (mode.value === 3) {
          eraserOn.value = 0;
          runOnJS(jsEraseEnd)();
        }
        mode.value = 0;
        pinchStart.value = [sc.value, tx.value, ty.value, e.focalX, e.focalY];
      })
      .onUpdate((e) => {
        'worklet';
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
        const fit = viewW.value / contentW.value;
        if (sc.value < fit) {
          // snap back to fit width when zoomed out
          sc.value = withTiming(fit, { duration: 160 });
          tx.value = withTiming(clampTx(0, fit), { duration: 160 });
          ty.value = withTiming(clampTy(ty.value, fit), { duration: 160 });
        }
      });

    return Gesture.Simultaneous(pan, pinch);
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

  const eraserStroke = useDerivedValue(() => 1.5 / sc.value);

  const visible = useMemo(() => {
    const out: React.ReactNode[] = [];
    const last = Math.min(range.last, pages.length - 1);
    for (let i = Math.max(0, range.first); i <= last; i++) {
      const L = layout.flat;
      out.push(<PageLayer key={pages[i].id} docId={docId} page={pages[i]} x={L[i * 4]} y={L[i * 4 + 1]} />);
    }
    return out;
  }, [range, pages, layout, docId]);

  return (
    <GestureDetector gesture={gesture}>
      <View style={styles.fill} onLayout={onLayout} collapsable={false}>
        <Canvas style={StyleSheet.absoluteFill}>
          <Group transform={contentTransform}>
            {visible}
            <Path
              path={livePath}
              color={liveColor}
              opacity={liveOpacity}
              blendMode={tool === 'highlighter' ? 'multiply' : 'srcOver'}
            />
            <Circle cx={erX} cy={erY} r={erR} style="stroke" strokeWidth={eraserStroke} color="#5C6BC0" opacity={eraserOn} />
          </Group>
        </Canvas>
      </View>
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: theme.canvasBg, overflow: 'hidden' },
});
