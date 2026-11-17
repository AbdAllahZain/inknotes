import * as FileSystem from 'expo-file-system';
import { BlendMode, degrees, PDFDocument, PDFImage, PDFPage, rgb } from 'pdf-lib';
import { templateGeometry, paperColor } from '../templates';
import {
  itemIsHighlight,
  itemOpacity,
  rasterizeText,
  shapePolys,
  strokeOutline,
} from '../ink/render';
import type { Doc, Item, Page } from '../types';
import { makeMapper, polyToSvg, type Mapper } from './pdfMap';
import { docDir, pdfPathOf } from './storage';

function hexToRgb(hex: string) {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16);
  return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
}

type Ctx = { pdf: PDFDocument; docId: string; images: Map<string, PDFImage> };

async function drawItem(ctx: Ctx, page: PDFPage, item: Item, m: Mapper) {
  if (item.k === 's' || item.k === 'h') {
    const polys = item.k === 's' ? [strokeOutline(item)] : shapePolys(item);
    const opacity = itemOpacity(item);
    const blend = itemIsHighlight(item) ? BlendMode.Multiply : BlendMode.Normal;
    for (const poly of polys) {
      if (poly.length < 6) continue;
      page.drawSvgPath(polyToSvg(poly, m), {
        x: 0,
        y: 0,
        color: hexToRgb(item.color),
        opacity,
        blendMode: blend,
      });
    }
  } else if (item.k === 't') {
    const r = rasterizeText(item, 3);
    if (!r) return;
    const img = await ctx.pdf.embedPng(r.base64);
    const [ax, ay] = m.map(item.x, item.y + r.h);
    page.drawImage(img, { x: ax, y: ay, width: r.w * m.sx, height: r.h * m.sy, rotate: degrees(m.rot) });
  } else {
    let img = ctx.images.get(item.file);
    if (!img) {
      const b64 = await FileSystem.readAsStringAsync(docDir(ctx.docId) + item.file, {
        encoding: FileSystem.EncodingType.Base64,
      });
      img = item.file.toLowerCase().endsWith('.png') ? await ctx.pdf.embedPng(b64) : await ctx.pdf.embedJpg(b64);
      ctx.images.set(item.file, img);
    }
    const [ax, ay] = m.map(item.x, item.y + item.h);
    page.drawImage(img, { x: ax, y: ay, width: item.w * m.sx, height: item.h * m.sy, rotate: degrees(m.rot) });
  }
}

function drawPaper(page: PDFPage, p: Page) {
  const paper = paperColor(p.bg);
  if (paper !== '#FFFFFF') {
    page.drawRectangle({ x: 0, y: 0, width: p.w, height: p.h, color: hexToRgb(paper) });
  }
  const g = templateGeometry(p.bg, p.w, p.h);
  const col = hexToRgb(g.color);
  for (const l of g.lines) {
    page.drawLine({ start: { x: l[0], y: p.h - l[1] }, end: { x: l[2], y: p.h - l[3] }, thickness: 0.6, color: col });
  }
  for (const d of g.dots) {
    page.drawCircle({ x: d[0], y: p.h - d[1], size: 0.9, color: col });
  }
}

export function safeFileName(name: string): string {
  const s = name.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').trim();
  return s.length ? s.slice(0, 80) : 'inknotes';
}

/**
 * Builds a PDF following the page order of the document: original PDF pages (copied from the source),
 * pages added in the app (blank/ruled), and every piece of ink, shape, text and picture as vector/raster graphics.
 */
export async function exportDocToPdf(doc: Doc): Promise<string> {
  const out = await PDFDocument.create();
  let src: PDFDocument | null = null;
  if (doc.type === 'pdf') {
    const b64 = await FileSystem.readAsStringAsync(pdfPathOf(doc.id), { encoding: FileSystem.EncodingType.Base64 });
    src = await PDFDocument.load(b64, { ignoreEncryption: true, updateMetadata: false });
  }
  const ctx: Ctx = { pdf: out, docId: doc.id, images: new Map() };
  for (const p of doc.pages) {
    let page: PDFPage;
    let fromSource = false;
    if (src && p.bg === 'pdf' && p.pdfIndex !== undefined && p.pdfIndex < src.getPageCount()) {
      const [copied] = await out.copyPages(src, [p.pdfIndex]);
      page = out.addPage(copied);
      fromSource = true;
    } else {
      page = out.addPage([p.w, p.h]);
      drawPaper(page, p);
    }
    if (!p.items.length) continue;
    const m = makeMapper(page, p, !fromSource);
    for (const item of p.items) await drawItem(ctx, page, item, m);
  }
  out.setTitle(doc.title);
  const base64 = await out.saveAsBase64();
  const path = FileSystem.cacheDirectory + safeFileName(doc.title) + '.pdf';
  await FileSystem.writeAsStringAsync(path, base64, { encoding: FileSystem.EncodingType.Base64 });
  return path;
}
