import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, AppState, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import * as Sharing from 'expo-sharing';
import * as DocumentPicker from 'expo-document-picker';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { EditorCanvas, GotoRequest, SelectionSnap } from '../editor/EditorCanvas';
import { PagesManager } from '../editor/PagesManager';
import { PageScrubber } from '../editor/PageScrubber';
import { SelectionBar } from '../editor/SelectionBar';
import { Toolbar } from '../editor/Toolbar';
import { applyOp, Op } from '../editor/history';
import { applyAffine, hitItem, itemBounds, lassoHits, recolorItem, unionBounds, type Measure } from '../ink/geometry';
import { loadImage, textBox } from '../ink/render';
import { t } from '../i18n';
import type { RootStackParamList } from '../navigation';
import { exportDocToPdf } from '../services/exporter';
import { exportPageAsPng, exportPagesAsZip, importImage } from '../services/media';
import { loadDoc, newPage, saveDoc, uid } from '../services/storage';
import { useSettings } from '../settings';
import { Palette, useStyles, useTheme } from '../theme';
import { COLORS, DEFAULT_SIZE, HIGHLIGHT_COLORS } from '../tools';
import { Doc, Item, Page, PageBg, PAPER_CHOICES, ShapeItem, ShapeKind, StrokeItem, TextItem, ToolId } from '../types';
import { ErrorBoundary } from '../ui/ErrorBoundary';
import { PromptModal } from '../ui/PromptModal';
import { SheetItem, SheetMenu } from '../ui/SheetMenu';

type Props = NativeStackScreenProps<RootStackParamList, 'Editor'>;
type Snap = SelectionSnap & { pageId: string };

const measure: Measure = (tx: TextItem) => {
  const b = textBox(tx);
  return { w: b.w, h: b.h };
};

async function shareFile(path: string, mimeType: string, title: string) {
  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(path, {
      mimeType,
      dialogTitle: title,
      UTI: mimeType === 'application/pdf' ? 'com.adobe.pdf' : undefined,
    });
  }
}

function EditorInner({ route, navigation }: Props) {
  const { docId } = route.params;
  const th = useTheme();
  const styles = useStyles(makeStyles);
  const { settings, update } = useSettings();
  const stylusOnly = settings.stylusOnly;

  const [doc, setDoc] = useState<Doc | null>(null);
  const docRef = useRef<Doc | null>(null);
  const dirty = useRef(false);
  const undoStack = useRef<Op[]>([]);
  const redoStack = useRef<Op[]>([]);
  const [, bump] = useState(0);
  const eraseBuf = useRef<{ pageId: string; item: Item }[]>([]);

  const [tool, setTool] = useState<ToolId>('pen');
  const [color, setColor] = useState(COLORS[0]);
  const [hlColor, setHlColor] = useState(HIGHLIGHT_COLORS[0]);
  const [sizes, setSizes] = useState<Record<ToolId, number>>({ ...DEFAULT_SIZE });
  const [shape, setShape] = useState<ShapeKind>('rect');
  const [curPage, setCurPage] = useState(0);
  const curPageRef = useRef(0);
  curPageRef.current = curPage;
  const [goto, setGoto] = useState<GotoRequest | null>(null);
  const [fitNonce, setFitNonce] = useState(0);
  const [newBg, setNewBg] = useState<PageBg>('lined');
  const [rulerOn, setRulerOn] = useState(false);
  const [menu, setMenu] = useState(false);
  const [paperMenu, setPaperMenu] = useState(false);
  const [renameOpen, setRenameOpen] = useState(false);
  const [pagesOpen, setPagesOpen] = useState(false);
  const [gotoOpen, setGotoOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState(false);
  const [textEdit, setTextEdit] = useState<{ pageIndex: number; x: number; y: number; item?: TextItem } | null>(null);
  const [selSnap, setSelSnap] = useState<Snap | null>(null);
  const selRef = useRef<Snap | null>(null);
  selRef.current = selSnap;

  // ---- load ---------------------------------------------------------------
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const d = await loadDoc(docId);
        if (!alive) return;
        docRef.current = d;
        setDoc(d);
        setNewBg(d.type === 'pdf' ? 'blank' : 'lined');
        const last = d.pages[d.pages.length - 1]?.bg;
        if (d.type === 'note' && last && last !== 'pdf') setNewBg(last);
      } catch {
        if (alive) setError(true);
      }
    })();
    return () => {
      alive = false;
    };
  }, [docId]);

  // ---- autosave -----------------------------------------------------------
  const flush = useCallback(async () => {
    if (!dirty.current || !docRef.current) return;
    dirty.current = false;
    try {
      await saveDoc({ ...docRef.current });
    } catch {
      dirty.current = true;
    }
  }, []);

  useEffect(() => {
    if (!doc || !dirty.current) return;
    const h = setTimeout(flush, 700);
    return () => clearTimeout(h);
  }, [doc, flush]);

  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => {
      if (s !== 'active') flush();
    });
    return () => {
      sub.remove();
      flush();
    };
  }, [flush]);

  // ---- state helpers ------------------------------------------------------
  const setDocState = (d: Doc) => {
    docRef.current = d;
    dirty.current = true;
    setDoc(d);
  };

  const commit = (op: Op) => {
    const d = docRef.current;
    if (!d) return;
    setDocState(applyOp(d, op, false));
    undoStack.current.push(op);
    if (undoStack.current.length > 200) undoStack.current.shift();
    redoStack.current = [];
    bump((n) => n + 1);
  };

  const undo = () => {
    const op = undoStack.current.pop();
    const d = docRef.current;
    if (!op || !d) return;
    setSelSnap(null);
    setDocState(applyOp(d, op, true));
    redoStack.current.push(op);
    bump((n) => n + 1);
  };

  const redo = () => {
    const op = redoStack.current.pop();
    const d = docRef.current;
    if (!op || !d) return;
    setSelSnap(null);
    setDocState(applyOp(d, op, false));
    undoStack.current.push(op);
    bump((n) => n + 1);
  };

  const gotoPage = (i: number, instant = false) => setGoto({ page: i, nonce: Date.now() + Math.random(), instant });

  // ---- selection ----------------------------------------------------------
  const makeSnap = (pageIndex: number, items: Item[]): Snap | null => {
    const d = docRef.current;
    const page = d?.pages[pageIndex];
    if (!page || !items.length) return null;
    return {
      pageId: page.id,
      pageIndex,
      items,
      bounds: unionBounds(items.map((it) => itemBounds(it, measure))),
    };
  };

  const onSelectTap = useCallback((pageIndex: number, x: number, y: number) => {
    const page = docRef.current?.pages[pageIndex];
    if (!page) return;
    for (let i = page.items.length - 1; i >= 0; i--) {
      if (hitItem(page.items[i], x, y, 10, measure)) {
        setSelSnap(makeSnap(pageIndex, [page.items[i]]));
        return;
      }
    }
    setSelSnap(null);
  }, []);

  const onLasso = useCallback((pageIndex: number, poly: number[]) => {
    const page = docRef.current?.pages[pageIndex];
    if (!page) return;
    const hit = page.items.filter((it) => lassoHits(it, poly, measure));
    setSelSnap(hit.length ? makeSnap(pageIndex, hit) : null);
  }, []);

  const onSelectionTransform = useCallback((s: number, tx: number, ty: number) => {
    const snap = selRef.current;
    const d = docRef.current;
    const page = d?.pages.find((p) => p.id === snap?.pageId);
    if (!snap || !page) return;
    const before: Item[] = [];
    const after: Item[] = [];
    for (const base of snap.items) {
      const cur = page.items.find((i) => i.id === base.id);
      if (!cur) continue;
      before.push(cur);
      after.push(applyAffine(base, s, tx, ty));
    }
    if (before.length) commit({ t: 'xform', pageId: page.id, before, after });
  }, []);

  const currentSelItems = (): { page: Page; items: Item[] } | null => {
    const snap = selRef.current;
    const page = docRef.current?.pages.find((p) => p.id === snap?.pageId);
    if (!snap || !page) return null;
    const items = snap.items.map((b) => page.items.find((i) => i.id === b.id)).filter(Boolean) as Item[];
    return { page, items };
  };

  const selDelete = () => {
    const cur = currentSelItems();
    if (!cur || !cur.items.length) return;
    commit({ t: 'del', entries: cur.items.map((item) => ({ pageId: cur.page.id, item })) });
    setSelSnap(null);
  };

  const selDuplicate = () => {
    const cur = currentSelItems();
    const snap = selRef.current;
    if (!cur || !snap || !cur.items.length) return;
    const copies = cur.items.map((it) => ({ ...applyAffine(it, 1, 18, 18), id: uid() }) as Item);
    commit({ t: 'addMany', entries: copies.map((item) => ({ pageId: cur.page.id, item })) });
    setSelSnap(makeSnap(snap.pageIndex, copies));
  };

  const selRecolor = (c: string) => {
    const cur = currentSelItems();
    const snap = selRef.current;
    if (!cur || !snap) return;
    const before = cur.items.filter((i) => i.k !== 'i');
    if (!before.length) return;
    const after = before.map((i) => recolorItem(i, c));
    commit({ t: 'xform', pageId: cur.page.id, before, after });
    const all = cur.items.map((i) => after.find((a) => a.id === i.id) ?? i);
    setSelSnap(makeSnap(snap.pageIndex, all));
  };

  // ---- canvas callbacks ---------------------------------------------------
  const onAddItem = useCallback((pageIndex: number, item: StrokeItem | ShapeItem) => {
    const d = docRef.current;
    const p = d?.pages[pageIndex];
    if (!d || !p) return;
    commit({ t: 'add', pageId: p.id, item });
  }, []);

  const onEraseAt = useCallback((pageIndex: number, x: number, y: number, r: number) => {
    const d = docRef.current;
    const p = d?.pages[pageIndex];
    if (!d || !p) return;
    const entries: { pageId: string; item: Item }[] = [];
    for (const it of p.items) if (hitItem(it, x, y, r, measure)) entries.push({ pageId: p.id, item: it });
    if (!entries.length) return;
    eraseBuf.current.push(...entries);
    setDocState(applyOp(d, { t: 'del', entries }, false));
  }, []);

  const onEraseEnd = useCallback(() => {
    if (!eraseBuf.current.length) return;
    undoStack.current.push({ t: 'del', entries: eraseBuf.current });
    redoStack.current = [];
    eraseBuf.current = [];
    bump((n) => n + 1);
  }, []);

  const onTextTap = useCallback((pageIndex: number, x: number, y: number) => {
    const d = docRef.current;
    const p = d?.pages[pageIndex];
    if (!d || !p) return;
    for (let i = p.items.length - 1; i >= 0; i--) {
      const it = p.items[i];
      if (it.k === 't') {
        const b = textBox(it);
        if (x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h) {
          setTextEdit({ pageIndex, x: it.x, y: it.y, item: it });
          return;
        }
      }
    }
    setTextEdit({ pageIndex, x, y });
  }, []);

  // ---- tools / colors -----------------------------------------------------
  const curBg = doc?.pages[Math.min(curPage, (doc?.pages.length ?? 1) - 1)]?.bg;
  // black ink on dark paper would be invisible: use a light ink automatically
  const baseColor = tool === 'highlighter' ? hlColor : color;
  const activeColor = curBg === 'dark' && baseColor === COLORS[0] ? '#F5F5F5' : baseColor;
  const setActiveColor = (c: string) => (tool === 'highlighter' ? setHlColor(c) : setColor(c));
  const activeSize = sizes[tool];

  const chooseTool = (next: ToolId) => {
    setTool(next);
    if (next !== 'select') setSelSnap(null);
  };

  const confirmText = (value: string) => {
    const te = textEdit;
    const d = docRef.current;
    setTextEdit(null);
    if (!te || !d) return;
    const p = d.pages[te.pageIndex];
    if (!p) return;
    const text = value.trim();
    if (te.item) {
      if (!text) commit({ t: 'del', entries: [{ pageId: p.id, item: te.item }] });
      else if (text !== te.item.text) commit({ t: 'edit', pageId: p.id, before: te.item, after: { ...te.item, text } });
      return;
    }
    if (!text) return;
    const item: TextItem = {
      id: uid(),
      k: 't',
      x: te.x,
      y: te.y,
      w: Math.max(140, Math.min(360, p.w - te.x - 12)),
      text,
      color: activeColor,
      fontSize: sizes.text,
    };
    commit({ t: 'add', pageId: p.id, item });
  };

  const deleteText = () => {
    const te = textEdit;
    const d = docRef.current;
    setTextEdit(null);
    if (!te?.item || !d) return;
    const p = d.pages[te.pageIndex];
    if (p) commit({ t: 'del', entries: [{ pageId: p.id, item: te.item }] });
  };

  // ---- images -------------------------------------------------------------
  const pickImage = async () => {
    const d = docRef.current;
    if (!d) return;
    const res = await DocumentPicker.getDocumentAsync({ type: 'image/*', copyToCacheDirectory: true });
    if (res.canceled || !res.assets?.length) return;
    const a = res.assets[0];
    setBusy(t('loading'));
    try {
      const { file, w, h } = await importImage(d.id, a.uri, a.name ?? 'image.jpg');
      await loadImage(d.id, file);
      const pageIndex = Math.min(curPageRef.current, d.pages.length - 1);
      const page = d.pages[pageIndex];
      let iw = Math.min(page.w * 0.55, w);
      let ih = (iw * h) / w;
      if (ih > page.h * 0.6) {
        ih = page.h * 0.6;
        iw = (ih * w) / h;
      }
      const item: Item = {
        id: uid(),
        k: 'i',
        x: Math.round((page.w - iw) / 2),
        y: Math.round(Math.min(120, (page.h - ih) / 2)),
        w: Math.round(iw),
        h: Math.round(ih),
        file,
      };
      commit({ t: 'add', pageId: page.id, item });
      setTool('select');
      setSelSnap(makeSnap(pageIndex, [item]));
    } catch {
      Alert.alert(t('imageFailed'));
    } finally {
      setBusy(null);
    }
  };

  // ---- pages --------------------------------------------------------------
  const blankLike = (src: Page | undefined, bg: PageBg): Page => {
    if (!src) return newPage(bg);
    return { id: uid(), w: src.w, h: src.h, bg, items: [] };
  };

  const addPage = () => {
    const d = docRef.current;
    if (!d) return;
    const at = Math.min(curPage, d.pages.length - 1);
    commit({ t: 'addPage', index: at + 1, page: blankLike(d.pages[at], newBg) });
    setSelSnap(null);
    gotoPage(at + 1);
  };

  const deletePageAt = (index: number) => {
    const d = docRef.current;
    if (!d) return;
    if (d.pages.length <= 1) {
      Alert.alert(t('lastPage'));
      return;
    }
    const page = d.pages[index];
    if (!page) return;
    commit({ t: 'delPage', index, page });
    setSelSnap(null);
  };

  const duplicatePageAt = (index: number) => {
    const d = docRef.current;
    const src = d?.pages[index];
    if (!d || !src) return;
    commit({ t: 'addPage', index: index + 1, page: { ...src, id: uid() } });
    setSelSnap(null);
  };

  const insertPageAfter = (index: number, bg: PageBg) => {
    const d = docRef.current;
    if (!d) return;
    commit({ t: 'addPage', index: index + 1, page: blankLike(d.pages[index], bg) });
    setSelSnap(null);
  };

  const movePage = (from: number, to: number) => {
    commit({ t: 'movePage', from, to });
    setSelSnap(null);
  };

  const changePaper = (bg: PageBg) => {
    setNewBg(bg);
    const d = docRef.current;
    const p = d?.pages[curPage];
    if (d && p && p.bg !== 'pdf' && p.bg !== bg) commit({ t: 'bg', pageId: p.id, from: p.bg, to: bg });
  };

  // ---- export -------------------------------------------------------------
  const doExportPdf = async () => {
    const d = docRef.current;
    if (!d) return;
    setBusy(t('exporting'));
    try {
      await flush();
      await shareFile(await exportDocToPdf(d), 'application/pdf', d.title);
    } catch (e) {
      Alert.alert(t('exportFailed'), String((e as Error)?.message ?? e));
    } finally {
      setBusy(null);
    }
  };

  const doExportImage = async () => {
    const d = docRef.current;
    if (!d) return;
    setBusy(t('exportingImages'));
    try {
      await flush();
      await shareFile(await exportPageAsPng(d, Math.min(curPage, d.pages.length - 1)), 'image/png', d.title);
    } catch (e) {
      Alert.alert(t('exportFailed'), String((e as Error)?.message ?? e));
    } finally {
      setBusy(null);
    }
  };

  const doExportAllImages = async () => {
    const d = docRef.current;
    if (!d) return;
    if (d.pages.length > 40) {
      Alert.alert(t('tooManyPages'));
      return;
    }
    setBusy(t('exportingImages'));
    try {
      await flush();
      await shareFile(await exportPagesAsZip(d), 'application/zip', d.title);
    } catch (e) {
      Alert.alert(t('exportFailed'), String((e as Error)?.message ?? e));
    } finally {
      setBusy(null);
    }
  };

  // ---- menus --------------------------------------------------------------
  const menuItems: SheetItem[] = [
    { key: 'pages', icon: '▦', label: t('managePages'), onPress: () => setPagesOpen(true) },
    { key: 'goto', icon: '⇅', label: t('goToPage'), onPress: () => setGotoOpen(true) },
    { key: 'addPage', icon: '＋', label: t('addPage'), onPress: addPage },
    { key: 'delPage', icon: '🗑', label: t('deletePage'), danger: true, onPress: () => deletePageAt(curPage) },
    { key: 'paper', icon: '▤', label: t('paper'), onPress: () => setPaperMenu(true) },
    { key: 'fit', icon: '⤢', label: t('fitWidth'), onPress: () => setFitNonce((n) => n + 1) },
    {
      key: 'stylus',
      icon: '✍',
      label: t('stylusOnly'),
      hint: t('stylusOnlyHint'),
      checked: stylusOnly,
      keepOpen: true,
      onPress: () => update({ stylusOnly: !stylusOnly }),
    },
    { key: 'rename', icon: '✎', label: t('rename'), onPress: () => setRenameOpen(true) },
    { key: 'export', icon: '⇪', label: t('exportPdf'), onPress: doExportPdf },
    { key: 'exportImg', icon: '🖼', label: t('exportImage'), onPress: doExportImage },
    { key: 'exportAll', icon: '🗂', label: t('exportAllImages'), onPress: doExportAllImages },
  ];

  const paperItems: SheetItem[] = PAPER_CHOICES.map((bg) => ({
    key: bg,
    label: t(bg as 'blank'),
    checked: docRef.current?.pages[curPage]?.bg === bg,
    onPress: () => changePaper(bg),
  }));

  if (error) {
    return (
      <SafeAreaView style={styles.center}>
        <Text style={{ color: th.danger, fontSize: 16 }}>{t('pdfFailed')}</Text>
        <Pressable onPress={() => navigation.goBack()} style={styles.backBtn}>
          <Text style={{ color: th.primaryText, fontWeight: '700' }}>{t('close')}</Text>
        </Pressable>
      </SafeAreaView>
    );
  }

  const total = doc?.pages.length ?? 0;
  const shownPage = Math.min(curPage + 1, Math.max(total, 1));
  const selCount = selSnap?.items.length ?? 0;
  const canColor = !!selSnap && selSnap.items.some((i) => i.k !== 'i');

  return (
    <SafeAreaView style={styles.root} edges={['top', 'left', 'right', 'bottom']}>
      <StatusBar style={th.isDark ? 'light' : 'dark'} />
      <View style={styles.topBar}>
        <Pressable onPress={() => navigation.goBack()} style={styles.iconBtn} hitSlop={6}>
          <Text style={styles.iconText}>‹</Text>
        </Pressable>
        <Pressable style={{ flex: 1 }} onPress={() => setRenameOpen(true)}>
          <Text numberOfLines={1} style={styles.title}>
            {doc?.title ?? t('loading')}
          </Text>
        </Pressable>
        <Pressable
          onPress={undo}
          disabled={!undoStack.current.length}
          style={[styles.iconBtn, !undoStack.current.length && styles.faded]}
          hitSlop={6}
        >
          <Text style={styles.iconText}>↶</Text>
        </Pressable>
        <Pressable
          onPress={redo}
          disabled={!redoStack.current.length}
          style={[styles.iconBtn, !redoStack.current.length && styles.faded]}
          hitSlop={6}
        >
          <Text style={styles.iconText}>↷</Text>
        </Pressable>
        <Pressable onPress={() => setMenu(true)} style={styles.iconBtn} hitSlop={6}>
          <Text style={styles.iconText}>⋮</Text>
        </Pressable>
      </View>

      <View style={{ flex: 1 }}>
        {doc ? (
          <EditorCanvas
            docId={doc.id}
            pages={doc.pages}
            tool={tool}
            color={activeColor}
            size={activeSize}
            shape={shape}
            stylusOnly={stylusOnly}
            gotoRequest={goto}
            fitNonce={fitNonce}
            selection={selSnap}
            rulerOn={rulerOn}
            onAddItem={onAddItem}
            onEraseAt={onEraseAt}
            onEraseEnd={onEraseEnd}
            onTextTap={onTextTap}
            onCurrentPage={setCurPage}
            onSelectTap={onSelectTap}
            onLasso={onLasso}
            onSelectionTransform={onSelectionTransform}
          />
        ) : (
          <View style={styles.center}>
            <ActivityIndicator color={th.primary} />
          </View>
        )}
        {doc ? <PageScrubber total={total} current={curPage} onScrub={(i) => gotoPage(i, true)} /> : null}
        {doc ? (
          <View style={styles.pageNav} pointerEvents="box-none">
            <Pressable
              onPress={() => gotoPage(Math.max(0, curPage - 1))}
              disabled={curPage <= 0}
              style={[styles.navBtn, curPage <= 0 && styles.faded]}
              hitSlop={6}
            >
              <Text style={styles.navText}>◀</Text>
            </Pressable>
            <Pressable onPress={() => setGotoOpen(true)} style={styles.pageChip}>
              <Text style={styles.pageChipText}>
                {shownPage} / {total}
              </Text>
            </Pressable>
            <Pressable
              onPress={() => gotoPage(Math.min(total - 1, curPage + 1))}
              disabled={curPage >= total - 1}
              style={[styles.navBtn, curPage >= total - 1 && styles.faded]}
              hitSlop={6}
            >
              <Text style={styles.navText}>▶</Text>
            </Pressable>
            <Pressable onPress={() => setPagesOpen(true)} style={styles.navBtn} hitSlop={6}>
              <Text style={styles.navText}>▦</Text>
            </Pressable>
          </View>
        ) : null}
        {busy ? (
          <View style={styles.busy}>
            <ActivityIndicator color="#fff" />
            <Text style={{ color: '#fff', marginTop: 10 }}>{busy}</Text>
          </View>
        ) : null}
      </View>

      {selSnap ? (
        <SelectionBar
          count={selCount}
          canColor={canColor}
          onDelete={selDelete}
          onDuplicate={selDuplicate}
          onColor={selRecolor}
          onDone={() => setSelSnap(null)}
        />
      ) : null}
      <Toolbar
        tool={tool}
        onTool={chooseTool}
        color={activeColor}
        onColor={setActiveColor}
        size={activeSize}
        onSize={(s) => setSizes((prev) => ({ ...prev, [tool]: s }))}
        shape={shape}
        onShape={setShape}
        rulerOn={rulerOn}
        onRuler={() => setRulerOn((v) => !v)}
        onImage={pickImage}
      />

      <SheetMenu visible={menu} items={menuItems} onClose={() => setMenu(false)} />
      <SheetMenu visible={paperMenu} title={t('paper')} items={paperItems} onClose={() => setPaperMenu(false)} />
      {doc ? (
        <PagesManager
          visible={pagesOpen}
          doc={doc}
          current={curPage}
          onClose={() => setPagesOpen(false)}
          onGoto={(i) => gotoPage(i, true)}
          onMove={movePage}
          onDuplicate={duplicatePageAt}
          onDelete={deletePageAt}
          onInsert={insertPageAfter}
        />
      ) : null}
      <PromptModal
        visible={renameOpen}
        title={t('rename')}
        initial={doc?.title}
        onCancel={() => setRenameOpen(false)}
        onOk={(v) => {
          setRenameOpen(false);
          const d = docRef.current;
          if (d && v.trim()) setDocState({ ...d, title: v.trim() });
        }}
      />
      <PromptModal
        visible={gotoOpen}
        title={t('goToPage') + ' (1 - ' + total + ')'}
        initial=""
        placeholder={t('pageNumber')}
        numeric
        onCancel={() => setGotoOpen(false)}
        onOk={(v) => {
          setGotoOpen(false);
          const n = parseInt(v, 10);
          if (!isNaN(n)) gotoPage(Math.max(0, Math.min(total - 1, n - 1)), true);
        }}
      />
      <PromptModal
        visible={!!textEdit}
        title={textEdit?.item ? t('editText') : t('text')}
        initial={textEdit?.item?.text ?? ''}
        placeholder={t('textHint')}
        multiline
        okLabel={t('save')}
        extraLabel={textEdit?.item ? t('delete') : undefined}
        extraDanger
        onExtra={deleteText}
        onCancel={() => setTextEdit(null)}
        onOk={confirmText}
      />
    </SafeAreaView>
  );
}

export function EditorScreen(props: Props) {
  return (
    <ErrorBoundary onBack={() => props.navigation.goBack()}>
      <EditorInner {...props} />
    </ErrorBoundary>
  );
}

const makeStyles = (th: Palette) =>
  StyleSheet.create({
    root: { flex: 1, backgroundColor: th.surface },
    center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, backgroundColor: th.bg },
    topBar: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: 6,
      paddingVertical: 4,
      backgroundColor: th.surface,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: th.border,
    },
    iconBtn: { width: 42, height: 42, alignItems: 'center', justifyContent: 'center', borderRadius: 21 },
    iconText: { fontSize: 24, color: th.text },
    faded: { opacity: 0.3 },
    title: { fontSize: 16.5, fontWeight: '700', color: th.text, paddingHorizontal: 6 },
    pageNav: { position: 'absolute', left: 10, bottom: 12, flexDirection: 'row', alignItems: 'center', gap: 6 },
    navBtn: {
      width: 38,
      height: 38,
      borderRadius: 19,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: 'rgba(27,29,42,0.78)',
    },
    navText: { color: '#fff', fontSize: 15, fontWeight: '700' },
    pageChip: { backgroundColor: 'rgba(27,29,42,0.78)', borderRadius: 19, paddingHorizontal: 14, height: 38, justifyContent: 'center' },
    pageChipText: { color: '#fff', fontSize: 14, fontWeight: '700' },
    busy: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.5)', alignItems: 'center', justifyContent: 'center' },
    backBtn: { marginTop: 18, backgroundColor: th.primary, borderRadius: 12, paddingHorizontal: 22, paddingVertical: 10 },
  });
