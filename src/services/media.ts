import * as FileSystem from 'expo-file-system';
import { zipSync } from 'fflate';
import { ImageFormat, Skia, type SkImage } from '@shopify/react-native-skia';
import { createBgPicture, createItemsPicture, imageFilesOf, loadImage } from '../ink/render';
import { paperColor } from '../templates';
import type { Doc, Page } from '../types';
import { base64ToBytes, bytesToBase64 } from './b64';
import { jpegInfo } from './exif';
import { docDir, ensurePageImage, ensurePageThumb, uid } from './storage';

const MAX_IMAGE_SIDE = 1800;

/**
 * Copies a picked picture into the document folder (normalised to JPEG/PNG, downscaled).
 * Phone photos taken in portrait are usually stored sideways with an EXIF flag, so the flag is honoured here.
 */
export async function importImage(
  docId: string,
  sourceUri: string,
  name: string
): Promise<{ file: string; w: number; h: number }> {
  const b64 = await FileSystem.readAsStringAsync(sourceUri, { encoding: FileSystem.EncodingType.Base64 });
  const img = Skia.Image.MakeImageFromEncoded(Skia.Data.fromBase64(b64));
  if (!img) throw new Error('unsupported image');
  const png = /\.png$/i.test(name);

  // Skia does not always apply the EXIF rotation: detect it by comparing the decoded size with the stored size.
  let rotate = 0;
  if (!png) {
    const info = jpegInfo(base64ToBytes(b64.slice(0, 131072)));
    if (info && (info.orientation === 6 || info.orientation === 8) && img.width() === info.width && img.height() === info.height) {
      rotate = info.orientation === 6 ? 90 : -90;
    }
  }
  const W0 = rotate !== 0 ? img.height() : img.width();
  const H0 = rotate !== 0 ? img.width() : img.height();
  const k = Math.min(1, MAX_IMAGE_SIDE / Math.max(W0, H0));
  let out: SkImage = img;
  if (k < 1 || rotate !== 0) {
    const w = Math.max(1, Math.round(W0 * k));
    const h = Math.max(1, Math.round(H0 * k));
    const surface = Skia.Surface.MakeOffscreen(w, h);
    if (surface) {
      const canvas = surface.getCanvas();
      canvas.scale(k, k);
      if (rotate === 90) {
        canvas.translate(W0, 0);
        canvas.rotate(90, 0, 0);
      } else if (rotate === -90) {
        canvas.translate(0, H0);
        canvas.rotate(-90, 0, 0);
      }
      canvas.drawImage(img, 0, 0);
      surface.flush();
      out = surface.makeImageSnapshot();
    }
  }
  const file = 'img-' + uid() + (png ? '.png' : '.jpg');
  const data = out.encodeToBase64(png ? ImageFormat.PNG : ImageFormat.JPEG, 88);
  await FileSystem.writeAsStringAsync(docDir(docId) + file, data, { encoding: FileSystem.EncodingType.Base64 });
  return { file, w: out.width(), h: out.height() };
}

/** Draws one page (paper + PDF image + ink + pictures) into an offscreen image. */
export async function renderPageSnapshot(docId: string, page: Page, scale: number): Promise<SkImage | null> {
  const W = Math.max(1, Math.round(page.w * scale));
  const H = Math.max(1, Math.round(page.h * scale));
  await Promise.all(imageFilesOf(page.items).map((f) => loadImage(docId, f)));
  let pdfImg: SkImage | null = null;
  if (page.bg === 'pdf') {
    const uri = await ensurePageImage(docId, page.pdfIndex ?? 0);
    pdfImg = Skia.Image.MakeImageFromEncoded(await Skia.Data.fromURI(uri));
  }
  const surface = Skia.Surface.MakeOffscreen(W, H);
  if (!surface) return null;
  const canvas = surface.getCanvas();
  canvas.scale(scale, scale);
  const paint = Skia.Paint();
  paint.setColor(Skia.Color(paperColor(page.bg)));
  canvas.drawRect(Skia.XYWHRect(0, 0, page.w, page.h), paint);
  const bg = createBgPicture(page.bg, page.w, page.h);
  if (bg) canvas.drawPicture(bg);
  if (pdfImg) {
    canvas.drawImageRect(
      pdfImg,
      Skia.XYWHRect(0, 0, pdfImg.width(), pdfImg.height()),
      Skia.XYWHRect(0, 0, page.w, page.h),
      Skia.Paint(),
      true
    );
  }
  canvas.drawPicture(createItemsPicture(page.items, page.w, page.h, docId));
  surface.flush();
  return surface.makeImageSnapshot();
}

const thumbCache = new WeakMap<Page, string>();

/** Small image (uri) of a page for the pages manager. */
export async function pageThumbUri(doc: Doc, page: Page): Promise<string | null> {
  const hit = thumbCache.get(page);
  if (hit) return hit;
  let uri: string | null = null;
  if (page.bg === 'pdf' && page.items.length === 0) {
    uri = await ensurePageThumb(doc.id, page.pdfIndex ?? 0);
  } else {
    const img = await renderPageSnapshot(doc.id, page, 150 / page.w);
    if (img) uri = 'data:image/jpeg;base64,' + img.encodeToBase64(ImageFormat.JPEG, 70);
  }
  if (uri) thumbCache.set(page, uri);
  return uri;
}

function safe(name: string): string {
  const s = name.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').trim();
  return s.length ? s.slice(0, 60) : 'page';
}

/** One page as a PNG file in the cache folder. */
export async function exportPageAsPng(doc: Doc, pageIndex: number): Promise<string> {
  const page = doc.pages[pageIndex];
  const img = await renderPageSnapshot(doc.id, page, 2.2);
  if (!img) throw new Error('render failed');
  const path = FileSystem.cacheDirectory + safe(doc.title) + '-' + (pageIndex + 1) + '.png';
  await FileSystem.writeAsStringAsync(path, img.encodeToBase64(ImageFormat.PNG, 100), {
    encoding: FileSystem.EncodingType.Base64,
  });
  return path;
}

/** Several pages as JPEG files bundled in a ZIP. */
export async function exportPagesAsZip(doc: Doc, onProgress?: (i: number, n: number) => void): Promise<string> {
  const files: Record<string, [Uint8Array, { level: 0 }]> = {};
  for (let i = 0; i < doc.pages.length; i++) {
    onProgress?.(i, doc.pages.length);
    const img = await renderPageSnapshot(doc.id, doc.pages[i], 1.8);
    if (!img) continue;
    files[safe(doc.title) + '-' + String(i + 1).padStart(3, '0') + '.jpg'] = [
      base64ToBytes(img.encodeToBase64(ImageFormat.JPEG, 86)),
      { level: 0 },
    ];
  }
  const zip = zipSync(files);
  const path = FileSystem.cacheDirectory + safe(doc.title) + '-pages.zip';
  await FileSystem.writeAsStringAsync(path, bytesToBase64(zip), { encoding: FileSystem.EncodingType.Base64 });
  return path;
}
