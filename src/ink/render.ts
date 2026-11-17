import {
  BlendMode,
  createPicture,
  ImageFormat,
  PaintStyle,
  Skia,
  TextAlign,
  TextDirection,
  type SkCanvas,
  type SkImage,
  type SkPaint,
  type SkParagraph,
  type SkPath,
  type SkPicture,
} from '@shopify/react-native-skia';
import { PRESETS } from '../tools';
import { templateGeometry } from '../templates';
import { docDir } from '../services/storage';
import type { ImageItem, Item, PageBg, ShapeItem, StrokeItem, TextItem } from '../types';
import { buildOutline, shapeOutlines, type Poly } from './engine';

/** Append a closed polygon to a Skia path (worklet: also used on the UI thread). */
export function appendPoly(path: SkPath, poly: Poly, ox: number, oy: number): void {
  'worklet';
  const n = poly.length;
  if (n < 6) return;
  path.moveTo(poly[0] + ox, poly[1] + oy);
  for (let i = 2; i < n; i += 2) {
    path.lineTo(poly[i] + ox, poly[i + 1] + oy);
  }
  path.close();
}

// ------------------------------------------------------------------ outlines

export function strokeOutline(item: StrokeItem): Poly {
  const p = PRESETS[item.tool];
  return buildOutline(item.pts, item.size, p.gain, p.minFrac);
}

export function shapePolys(item: ShapeItem): Poly[] {
  return shapeOutlines(item.shape, item.x1, item.y1, item.x2, item.y2, item.size);
}

/** Opacity of a stroke or of a shape that was snapped from a pen stroke. */
export function itemOpacity(item: StrokeItem | ShapeItem): number {
  const tool = item.k === 's' ? item.tool : item.tool;
  return tool ? PRESETS[tool].opacity : 1;
}

export function itemIsHighlight(item: StrokeItem | ShapeItem): boolean {
  const tool = item.k === 's' ? item.tool : item.tool;
  return tool === 'highlighter';
}

const pathCache = new WeakMap<object, SkPath>();

function itemPath(item: StrokeItem | ShapeItem): SkPath {
  let p = pathCache.get(item);
  if (p) return p;
  p = Skia.Path.Make();
  if (item.k === 's') {
    appendPoly(p, strokeOutline(item), 0, 0);
  } else {
    const polys = shapePolys(item);
    for (let i = 0; i < polys.length; i++) appendPoly(p, polys[i], 0, 0);
  }
  pathCache.set(item, p);
  return p;
}

// ---------------------------------------------------------------------- text

const RTL_RE = /[\u0590-\u08FF\uFB1D-\uFDFF\uFE70-\uFEFF]/;
const paraCache = new WeakMap<object, SkParagraph>();

export function makeParagraph(item: TextItem): SkParagraph {
  let para = paraCache.get(item);
  if (para) return para;
  const rtl = RTL_RE.test(item.text);
  const builder = Skia.ParagraphBuilder.Make({
    textAlign: TextAlign.Start,
    textDirection: rtl ? TextDirection.RTL : TextDirection.LTR,
  });
  builder.pushStyle({
    color: Skia.Color(item.color),
    fontSize: item.fontSize,
    fontFamilies: ['Roboto', 'Noto Naskh Arabic', 'Noto Sans Arabic', 'sans-serif'],
  });
  builder.addText(item.text);
  para = builder.build();
  para.layout(item.w);
  paraCache.set(item, para);
  return para;
}

export function textBox(item: TextItem): { x: number; y: number; w: number; h: number } {
  const para = makeParagraph(item);
  return { x: item.x, y: item.y, w: item.w, h: Math.max(para.getHeight(), item.fontSize * 1.3) };
}

/** Render a text item to a transparent PNG (base64) – used by the PDF exporter. */
export function rasterizeText(item: TextItem, scale: number): { base64: string; w: number; h: number } | null {
  const para = makeParagraph(item);
  const h = Math.ceil(Math.max(para.getHeight(), item.fontSize * 1.3)) + 2;
  const w = Math.ceil(item.w);
  const surface = Skia.Surface.MakeOffscreen(Math.ceil(w * scale), Math.ceil(h * scale));
  if (!surface) return null;
  const canvas = surface.getCanvas();
  canvas.clear(Skia.Color('transparent'));
  canvas.scale(scale, scale);
  para.paint(canvas, 0, 0);
  surface.flush();
  const img = surface.makeImageSnapshot();
  const base64 = img.encodeToBase64(ImageFormat.PNG, 100);
  return { base64, w, h };
}

// -------------------------------------------------------------------- images

const imageCache = new Map<string, SkImage>();
const imageLoading = new Map<string, Promise<SkImage | null>>();

export function imageKey(docId: string, file: string): string {
  return docId + '/' + file;
}

export function getCachedImage(docId: string, file: string): SkImage | undefined {
  return imageCache.get(imageKey(docId, file));
}

/** Loads (and caches) an image stored in a document folder. */
export function loadImage(docId: string, file: string): Promise<SkImage | null> {
  const key = imageKey(docId, file);
  const hit = imageCache.get(key);
  if (hit) return Promise.resolve(hit);
  const pending = imageLoading.get(key);
  if (pending) return pending;
  const job = Skia.Data.fromURI(docDir(docId) + file)
    .then((data) => {
      const img = Skia.Image.MakeImageFromEncoded(data);
      if (img) imageCache.set(key, img);
      return img;
    })
    .catch(() => null)
    .then((img) => {
      imageLoading.delete(key);
      return img;
    });
  imageLoading.set(key, job);
  return job;
}

export function imageFilesOf(items: Item[]): string[] {
  const out: string[] = [];
  for (const it of items) if (it.k === 'i') out.push(it.file);
  return out;
}

// ------------------------------------------------------------------- drawing

function drawImageItem(canvas: SkCanvas, paint: SkPaint, item: ImageItem, docId: string) {
  const img = getCachedImage(docId, item.file);
  if (!img) return;
  paint.setAlphaf(1);
  paint.setBlendMode(BlendMode.SrcOver);
  canvas.drawImageRect(
    img,
    Skia.XYWHRect(0, 0, img.width(), img.height()),
    Skia.XYWHRect(item.x, item.y, item.w, item.h),
    paint,
    true
  );
}

function drawItem(canvas: SkCanvas, paint: SkPaint, item: Item, docId: string) {
  if (item.k === 't') {
    makeParagraph(item).paint(canvas, item.x, item.y);
    return;
  }
  if (item.k === 'i') {
    drawImageItem(canvas, paint, item, docId);
    return;
  }
  paint.setStyle(PaintStyle.Fill);
  paint.setColor(Skia.Color(item.color));
  paint.setAlphaf(itemOpacity(item));
  paint.setBlendMode(itemIsHighlight(item) ? BlendMode.Multiply : BlendMode.SrcOver);
  canvas.drawPath(itemPath(item), paint);
}

/** Records all items of a page into an SkPicture (cheap to replay while panning/zooming). */
export function createItemsPicture(items: Item[], w: number, h: number, docId = ''): SkPicture {
  return createPicture((canvas) => {
    const paint = Skia.Paint();
    paint.setAntiAlias(true);
    for (let i = 0; i < items.length; i++) drawItem(canvas, paint, items[i], docId);
  }, Skia.XYWHRect(0, 0, w, h));
}

export function createBgPicture(bg: PageBg, w: number, h: number): SkPicture | null {
  if (bg === 'blank' || bg === 'pdf') return null;
  const g = templateGeometry(bg, w, h);
  return createPicture((canvas) => {
    const paint = Skia.Paint();
    paint.setAntiAlias(true);
    paint.setColor(Skia.Color(g.color));
    paint.setStyle(PaintStyle.Stroke);
    paint.setStrokeWidth(0.8);
    for (let i = 0; i < g.lines.length; i++) {
      const l = g.lines[i];
      canvas.drawLine(l[0], l[1], l[2], l[3], paint);
    }
    paint.setStyle(PaintStyle.Fill);
    for (let i = 0; i < g.dots.length; i++) {
      canvas.drawCircle(g.dots[i][0], g.dots[i][1], 1.3, paint);
    }
  }, Skia.XYWHRect(0, 0, w, h));
}
