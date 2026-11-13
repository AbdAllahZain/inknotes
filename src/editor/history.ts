import type { Doc, Item, Page, PageBg, TextItem } from '../types';

export type Op =
  | { t: 'add'; pageId: string; item: Item }
  | { t: 'del'; entries: { pageId: string; item: Item }[] }
  | { t: 'edit'; pageId: string; before: TextItem; after: TextItem }
  | { t: 'addPage'; index: number; page: Page }
  | { t: 'delPage'; index: number; page: Page }
  | { t: 'bg'; pageId: string; from: PageBg; to: PageBg };

function mapPage(doc: Doc, pageId: string, fn: (p: Page) => Page): Doc {
  return { ...doc, pages: doc.pages.map((p) => (p.id === pageId ? fn(p) : p)) };
}

function addItems(doc: Doc, entries: { pageId: string; item: Item }[]): Doc {
  let d = doc;
  const byPage = new Map<string, Item[]>();
  for (const e of entries) {
    const arr = byPage.get(e.pageId) ?? [];
    arr.push(e.item);
    byPage.set(e.pageId, arr);
  }
  byPage.forEach((items, pageId) => {
    d = mapPage(d, pageId, (p) => ({ ...p, items: [...p.items, ...items] }));
  });
  return d;
}

function removeItems(doc: Doc, entries: { pageId: string; item: Item }[]): Doc {
  let d = doc;
  const byPage = new Map<string, Set<string>>();
  for (const e of entries) {
    const s = byPage.get(e.pageId) ?? new Set<string>();
    s.add(e.item.id);
    byPage.set(e.pageId, s);
  }
  byPage.forEach((ids, pageId) => {
    d = mapPage(d, pageId, (p) => ({ ...p, items: p.items.filter((it) => !ids.has(it.id)) }));
  });
  return d;
}

/** Apply an operation (invert = undo). */
export function applyOp(doc: Doc, op: Op, invert: boolean): Doc {
  switch (op.t) {
    case 'add':
      return invert ? removeItems(doc, [{ pageId: op.pageId, item: op.item }]) : addItems(doc, [{ pageId: op.pageId, item: op.item }]);
    case 'del':
      return invert ? addItems(doc, op.entries) : removeItems(doc, op.entries);
    case 'edit': {
      const from = invert ? op.after : op.before;
      const to = invert ? op.before : op.after;
      return mapPage(doc, op.pageId, (p) => ({ ...p, items: p.items.map((it) => (it.id === from.id ? to : it)) }));
    }
    case 'addPage': {
      if (invert) return { ...doc, pages: doc.pages.filter((p) => p.id !== op.page.id) };
      const pages = doc.pages.slice();
      pages.splice(Math.min(op.index, pages.length), 0, op.page);
      return { ...doc, pages };
    }
    case 'delPage': {
      if (!invert) return { ...doc, pages: doc.pages.filter((p) => p.id !== op.page.id) };
      const pages = doc.pages.slice();
      pages.splice(Math.min(op.index, pages.length), 0, op.page);
      return { ...doc, pages };
    }
    case 'bg':
      return mapPage(doc, op.pageId, (p) => ({ ...p, bg: invert ? op.from : op.to }));
  }
}
