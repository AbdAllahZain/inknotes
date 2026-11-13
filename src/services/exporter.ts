import * as FileSystem from 'expo-file-system';
import { BlendMode, degrees, PDFDocument, PDFPage, rgb } from 'pdf-lib';
import { PRESETS } from '../tools';
import { templateGeometry } from '../templates';
import { rasterizeText, shapePolys, strokeOutline, textBox } from '../ink/render';
import type { Doc, Item, Page } from '../types';
import { makeMapper, polyToSvg, type Mapper } from './pdfMap';
import { pdfPathOf } from './storage';

function hexToRgb(hex: string) {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16);
  return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
}

async function drawItem(pdf: PDFDocument, page: PDFPage, item: Item, m: Mapper) {
  if (item.k === 's') {
    const poly = strokeOutline(item);
    if (poly.length < 6) return;
    const preset = PRESETS[item.tool];
    page.drawSvgPath(polyToSvg(poly, m), {
      x: 0,
      y: 0,
      color: hexToRgb(item.color),
      opacity: preset.opacity,
      blendMode: item.tool === 'highlighter' ? BlendMode.Multiply : BlendMode.Normal,
    });
  } else if (item.k === 'h') {
    const polys = shapePolys(item);
    for (const poly of polys) {
      if (poly.length < 6) continue;
      page.drawSvgPath(polyToSvg(poly, m), { x: 0, y: 0, color: hexToRgb(item.color), opacity: 1 });
    }
  } else {
    const box = textBox(item);
    const r = rasterizeText(item, 3);
    if (!r) return;
    const img = await pdf.embedPng(r.base64);
    const [ax, ay] = m.map(item.x, item.y + r.h);
    page.drawImage(img, {
      x: ax,
      y: ay,
      width: r.w * m.sx,
      height: r.h * m.sy,
      rotate: degrees(m.rot),
    });
    void box;
  }
}

function drawTemplate(page: PDFPage, p: Page) {
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

/** Builds a PDF containing the original pages (for PDF docs) plus all ink as vector graphics. */
export async function exportDocToPdf(doc: Doc): Promise<string> {
  let pdf: PDFDocument;
  let pdfPages: PDFPage[];
  const isNote = doc.type === 'note';
  if (isNote) {
    pdf = await PDFDocument.create();
    pdfPages = doc.pages.map((p) => pdf.addPage([p.w, p.h]));
  } else {
    const b64 = await FileSystem.readAsStringAsync(pdfPathOf(doc.id), { encoding: FileSystem.EncodingType.Base64 });
    pdf = await PDFDocument.load(b64, { ignoreEncryption: true, updateMetadata: false });
    pdfPages = pdf.getPages();
  }
  for (let i = 0; i < doc.pages.length; i++) {
    const p = doc.pages[i];
    const page = pdfPages[isNote ? i : p.pdfIndex ?? i];
    if (!page) continue;
    if (isNote) drawTemplate(page, p);
    if (!p.items.length) continue;
    const m = makeMapper(page, p, isNote);
    for (const item of p.items) await drawItem(pdf, page, item, m);
  }
  pdf.setTitle(doc.title);
  const out = await pdf.saveAsBase64();
  const path = FileSystem.cacheDirectory + safeFileName(doc.title) + '.pdf';
  await FileSystem.writeAsStringAsync(path, out, { encoding: FileSystem.EncodingType.Base64 });
  return path;
}
