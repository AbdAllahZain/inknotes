import * as FileSystem from 'expo-file-system';
import { Dimensions, PixelRatio } from 'react-native';
import { A4, DEFAULT_SETTINGS, Doc, DocMeta, Folder, Page, PageBg, Settings } from '../types';
import { getPdfPageSizes, renderPdfPage } from './pdfNative';

const ROOT = FileSystem.documentDirectory + 'inknotes/';
const CACHE = FileSystem.cacheDirectory + 'inknotes/';
const INDEX = ROOT + 'index.json';
const SETTINGS = ROOT + 'settings.json';

export function uid(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

export async function ensureDir(dir: string) {
  const info = await FileSystem.getInfoAsync(dir);
  if (!info.exists) await FileSystem.makeDirectoryAsync(dir, { intermediates: true });
}

export const docDir = (id: string) => ROOT + id + '/';
export const docJson = (id: string) => docDir(id) + 'doc.json';
export const pdfPathOf = (id: string) => docDir(id) + 'source.pdf';

// ------------------------------------------------------------------ settings

export async function loadSettings(): Promise<Settings> {
  try {
    const s = await FileSystem.readAsStringAsync(SETTINGS);
    return { ...DEFAULT_SETTINGS, ...JSON.parse(s) };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export async function saveSettings(s: Settings) {
  await ensureDir(ROOT);
  await FileSystem.writeAsStringAsync(SETTINGS, JSON.stringify(s));
}

// --------------------------------------------------------------------- index

export async function readIndex(): Promise<DocMeta[]> {
  try {
    const s = await FileSystem.readAsStringAsync(INDEX);
    const arr = JSON.parse(s);
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

export async function writeIndex(list: DocMeta[]) {
  await ensureDir(ROOT);
  await FileSystem.writeAsStringAsync(INDEX, JSON.stringify(list));
}

export async function listDocs(): Promise<DocMeta[]> {
  const list = await readIndex();
  return list.sort((a, b) => b.updatedAt - a.updatedAt);
}

function metaOf(doc: Doc, thumb?: string): DocMeta {
  return { id: doc.id, title: doc.title, type: doc.type, updatedAt: doc.updatedAt, pageCount: doc.pages.length, thumb };
}

// ----------------------------------------------------------------- documents

export async function loadDoc(id: string): Promise<Doc> {
  const s = await FileSystem.readAsStringAsync(docJson(id));
  return JSON.parse(s) as Doc;
}

export async function saveDoc(doc: Doc): Promise<void> {
  await ensureDir(docDir(doc.id));
  doc.updatedAt = Date.now();
  await FileSystem.writeAsStringAsync(docJson(doc.id), JSON.stringify(doc));
  const list = await readIndex();
  const i = list.findIndex((m) => m.id === doc.id);
  const thumb = i >= 0 ? list[i].thumb : undefined;
  const meta = metaOf(doc, thumb);
  if (i >= 0) {
    meta.folder = list[i].folder;
    meta.tags = list[i].tags;
  }
  if (i >= 0) list[i] = meta;
  else list.push(meta);
  await writeIndex(list);
}

export async function renameDoc(id: string, title: string) {
  const doc = await loadDoc(id);
  doc.title = title;
  await saveDoc(doc);
}

export async function deleteDoc(id: string) {
  try {
    await FileSystem.deleteAsync(docDir(id), { idempotent: true });
    await FileSystem.deleteAsync(CACHE + id + '/', { idempotent: true });
  } catch {}
  const list = await readIndex();
  await writeIndex(list.filter((m) => m.id !== id));
}

export function newPage(bg: PageBg): Page {
  return { id: uid(), w: A4.w, h: A4.h, bg, items: [] };
}

export async function createNote(title: string, bg: PageBg): Promise<Doc> {
  const now = Date.now();
  const doc: Doc = { id: uid(), title, type: 'note', createdAt: now, updatedAt: now, pages: [newPage(bg)] };
  await saveDoc(doc);
  return doc;
}

/** Page render scale: sharp enough for ~3x zoom on this screen. */
export function pdfRenderScale(): number {
  const px = Dimensions.get('window').width * PixelRatio.get();
  return Math.min(4, Math.max(2.5, (px / A4.w) * 1.8));
}

export function pageImagePath(docId: string, pageIndex: number): string {
  return CACHE + docId + '/p' + pageIndex + '_' + Math.round(pdfRenderScale() * 10) + '.jpg';
}

const inflight = new Map<string, Promise<string>>();

/** Returns a file:// uri of the rendered page image (rendering + caching it if needed). */
export function ensurePageImage(docId: string, pageIndex: number): Promise<string> {
  const out = pageImagePath(docId, pageIndex);
  const existing = inflight.get(out);
  if (existing) return existing;
  const job = (async () => {
    const info = await FileSystem.getInfoAsync(out);
    if (info.exists) return out;
    await ensureDir(CACHE + docId + '/');
    const r = await renderPdfPage(pdfPathOf(docId), pageIndex, pdfRenderScale(), out);
    return r.uri;
  })();
  inflight.set(out, job);
  job.then(
    () => inflight.delete(out),
    () => inflight.delete(out)
  );
  return job;
}

export async function importPdf(sourceUri: string, name: string): Promise<Doc> {
  const id = uid();
  await ensureDir(docDir(id));
  const target = pdfPathOf(id);
  await FileSystem.copyAsync({ from: sourceUri, to: target });
  let sizes: { width: number; height: number }[];
  try {
    sizes = await getPdfPageSizes(target);
    if (!sizes.length) throw new Error('empty pdf');
  } catch (e) {
    await FileSystem.deleteAsync(docDir(id), { idempotent: true });
    throw e;
  }
  const now = Date.now();
  const doc: Doc = {
    id,
    title: name.replace(/\.pdf$/i, ''),
    type: 'pdf',
    createdAt: now,
    updatedAt: now,
    pages: sizes.map((s, i) => ({ id: uid(), w: s.width, h: s.height, bg: 'pdf' as PageBg, items: [], pdfIndex: i })),
  };
  await saveDoc(doc);
  // small thumbnail of the first page for the home screen
  try {
    await ensureDir(CACHE + id + '/');
    const thumbPath = docDir(id) + 'thumb.jpg';
    const r = await renderPdfPage(target, 0, 0.6, thumbPath, 70);
    const list = await readIndex();
    const i = list.findIndex((m) => m.id === id);
    if (i >= 0) {
      list[i].thumb = r.uri;
      await writeIndex(list);
    }
  } catch {}
  return doc;
}


// ------------------------------------------------------------ folders & tags

const FOLDERS = ROOT + 'folders.json';

export async function listFolders(): Promise<Folder[]> {
  try {
    const arr = JSON.parse(await FileSystem.readAsStringAsync(FOLDERS));
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

async function writeFolders(list: Folder[]) {
  await ensureDir(ROOT);
  await FileSystem.writeAsStringAsync(FOLDERS, JSON.stringify(list));
}

export async function createFolder(name: string): Promise<Folder> {
  const list = await listFolders();
  const f = { id: uid(), name: name.trim() };
  list.push(f);
  await writeFolders(list);
  return f;
}

export async function renameFolder(id: string, name: string) {
  const list = await listFolders();
  await writeFolders(list.map((f) => (f.id === id ? { ...f, name: name.trim() } : f)));
}

export async function deleteFolder(id: string) {
  const list = await listFolders();
  await writeFolders(list.filter((f) => f.id !== id));
  const docs = await readIndex();
  await writeIndex(docs.map((d) => (d.folder === id ? { ...d, folder: undefined } : d)));
}

export async function setDocFolder(docId: string, folder: string | undefined) {
  const docs = await readIndex();
  await writeIndex(docs.map((d) => (d.id === docId ? { ...d, folder } : d)));
}

export async function setDocTags(docId: string, tags: string[]) {
  const clean = Array.from(new Set(tags.map((x) => x.trim()).filter(Boolean)));
  const docs = await readIndex();
  await writeIndex(docs.map((d) => (d.id === docId ? { ...d, tags: clean } : d)));
}

// ----------------------------------------------------------- page thumbnails

export function pageThumbPath(docId: string, pageIndex: number): string {
  return CACHE + docId + '/t' + pageIndex + '.jpg';
}

/** Small JPEG of a PDF page (for the pages manager). */
export async function ensurePageThumb(docId: string, pageIndex: number): Promise<string> {
  const out = pageThumbPath(docId, pageIndex);
  const info = await FileSystem.getInfoAsync(out);
  if (info.exists) return out;
  await ensureDir(CACHE + docId + '/');
  const r = await renderPdfPage(pdfPathOf(docId), pageIndex, 0.32, out, 62);
  return r.uri;
}
