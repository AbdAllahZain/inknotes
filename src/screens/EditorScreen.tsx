import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, AppState, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import * as Sharing from 'expo-sharing';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { EditorCanvas, GotoRequest } from '../editor/EditorCanvas';
import { Toolbar } from '../editor/Toolbar';
import { applyOp, Op } from '../editor/history';
import { distToPolyline } from '../ink/engine';
import { textBox } from '../ink/render';
import { shapePolylines } from '../ink/engine';
import { t } from '../i18n';
import type { RootStackParamList } from '../navigation';
import { exportDocToPdf } from '../services/exporter';
import { loadDoc, loadSettings, newPage, saveDoc, saveSettings, uid } from '../services/storage';
import { theme } from '../theme';
import { COLORS, DEFAULT_SIZE, HIGHLIGHT_COLORS } from '../tools';
import type { Doc, Item, PageBg, ShapeItem, ShapeKind, StrokeItem, TextItem, ToolId } from '../types';
import { PromptModal } from '../ui/PromptModal';
import { SheetMenu, SheetItem } from '../ui/SheetMenu';

type Props = NativeStackScreenProps<RootStackParamList, 'Editor'>;

function hitItem(it: Item, x: number, y: number, r: number): boolean {
  if (it.k === 's') return distToPolyline(x, y, it.pts) <= r + it.size / 2;
  if (it.k === 'h') {
    const lines = shapePolylines(it.shape, it.x1, it.y1, it.x2, it.y2);
    for (const l of lines) if (distToPolyline(x, y, l) <= r + it.size / 2) return true;
    return false;
  }
  const b = textBox(it);
  return x >= b.x - r && x <= b.x + b.w + r && y >= b.y - r && y <= b.y + b.h + r;
}

export function EditorScreen({ route, navigation }: Props) {
  const { docId } = route.params;
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
  const [stylusOnly, setStylusOnly] = useState(false);
  const [curPage, setCurPage] = useState(0);
  const [goto, setGoto] = useState<GotoRequest | null>(null);
  const [fitNonce, setFitNonce] = useState(0);
  const [newBg, setNewBg] = useState<PageBg>('lined');
  const [menu, setMenu] = useState(false);
  const [paperMenu, setPaperMenu] = useState(false);
  const [renameOpen, setRenameOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState(false);
  const [textEdit, setTextEdit] = useState<{ pageIndex: number; x: number; y: number; item?: TextItem } | null>(null);

  // ---- load ---------------------------------------------------------------
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const [d, s] = await Promise.all([loadDoc(docId), loadSettings()]);
        if (!alive) return;
        docRef.current = d;
        setDoc(d);
        setStylusOnly(s.stylusOnly);
        const firstBg = d.pages[d.pages.length - 1]?.bg;
        if (d.type === 'note' && firstBg && firstBg !== 'pdf') setNewBg(firstBg);
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
    setDocState(applyOp(d, op, true));
    redoStack.current.push(op);
    bump((n) => n + 1);
  };

  const redo = () => {
    const op = redoStack.current.pop();
    const d = docRef.current;
    if (!op || !d) return;
    setDocState(applyOp(d, op, false));
    undoStack.current.push(op);
    bump((n) => n + 1);
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
    for (const it of p.items) if (hitItem(it, x, y, r)) entries.push({ pageId: p.id, item: it });
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

  const confirmText = (value: string) => {
    const te = textEdit;
    const d = docRef.current;
    setTextEdit(null);
    if (!te || !d) return;
    const p = d.pages[te.pageIndex];
    if (!p) return;
    const text = value.trim();
    if (te.item) {
      if (!text) {
        commit({ t: 'del', entries: [{ pageId: p.id, item: te.item }] });
      } else if (text !== te.item.text) {
        commit({ t: 'edit', pageId: p.id, before: te.item, after: { ...te.item, text } });
      }
      return;
    }
    if (!text) return;
    const fs = sizes.text;
    const item: TextItem = {
      id: uid(),
      k: 't',
      x: te.x,
      y: te.y,
      w: Math.max(140, Math.min(360, p.w - te.x - 12)),
      text,
      color,
      fontSize: fs,
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

  // ---- toolbar state ------------------------------------------------------
  const activeColor = tool === 'highlighter' ? hlColor : color;
  const setActiveColor = (c: string) => (tool === 'highlighter' ? setHlColor(c) : setColor(c));
  const activeSize = sizes[tool];

  // ---- menu actions -------------------------------------------------------
  const addPage = () => {
    const d = docRef.current;
    if (!d || d.type !== 'note') return;
    const index = Math.min(curPage + 1, d.pages.length);
    commit({ t: 'addPage', index, page: newPage(newBg) });
    setGoto({ page: index, nonce: Date.now() });
  };

  const deletePage = () => {
    const d = docRef.current;
    if (!d || d.type !== 'note') return;
    if (d.pages.length <= 1) {
      Alert.alert(t('lastPage'));
      return;
    }
    const page = d.pages[curPage];
    if (page) commit({ t: 'delPage', index: curPage, page });
  };

  const changePaper = (bg: PageBg) => {
    setNewBg(bg);
    const d = docRef.current;
    const p = d?.pages[curPage];
    if (d && p && p.bg !== bg) commit({ t: 'bg', pageId: p.id, from: p.bg, to: bg });
  };

  const toggleStylus = () => {
    const next = !stylusOnly;
    setStylusOnly(next);
    saveSettings({ stylusOnly: next }).catch(() => {});
  };

  const doExport = async () => {
    const d = docRef.current;
    if (!d) return;
    setBusy(t('exporting'));
    try {
      await flush();
      const path = await exportDocToPdf(d);
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(path, { mimeType: 'application/pdf', dialogTitle: d.title, UTI: 'com.adobe.pdf' });
      }
    } catch (e) {
      Alert.alert(t('exportFailed'), String((e as Error)?.message ?? e));
    } finally {
      setBusy(null);
    }
  };

  const menuItems: SheetItem[] = [];
  if (doc?.type === 'note') {
    menuItems.push({ key: 'addPage', icon: '＋', label: t('addPage'), onPress: addPage });
    menuItems.push({ key: 'paper', icon: '▦', label: t('paper'), onPress: () => setPaperMenu(true) });
    menuItems.push({ key: 'delPage', icon: '🗑', label: t('deletePage'), danger: true, onPress: deletePage });
  }
  menuItems.push({ key: 'fit', icon: '⤢', label: t('fitWidth'), onPress: () => setFitNonce((n) => n + 1) });
  menuItems.push({
    key: 'stylus',
    icon: '✍',
    label: t('stylusOnly'),
    hint: t('stylusOnlyHint'),
    checked: stylusOnly,
    onPress: toggleStylus,
  });
  menuItems.push({ key: 'rename', icon: '✎', label: t('rename'), onPress: () => setRenameOpen(true) });
  menuItems.push({ key: 'export', icon: '⇪', label: t('exportPdf'), onPress: doExport });

  const paperItems: SheetItem[] = (['blank', 'lined', 'grid', 'dots'] as PageBg[]).map((bg) => ({
    key: bg,
    label: t(bg as 'blank'),
    checked: docRef.current?.pages[curPage]?.bg === bg,
    onPress: () => changePaper(bg),
  }));

  if (error) {
    return (
      <SafeAreaView style={styles.center}>
        <Text style={{ color: theme.danger, fontSize: 16 }}>{t('pdfFailed')}</Text>
        <Pressable onPress={() => navigation.goBack()} style={styles.backBtn}>
          <Text style={{ color: theme.primaryText, fontWeight: '700' }}>{t('close')}</Text>
        </Pressable>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.root} edges={['top', 'left', 'right', 'bottom']}>
      <StatusBar style="dark" />
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
          style={[styles.iconBtn, !undoStack.current.length && { opacity: 0.3 }]}
          hitSlop={6}
        >
          <Text style={styles.iconText}>↶</Text>
        </Pressable>
        <Pressable
          onPress={redo}
          disabled={!redoStack.current.length}
          style={[styles.iconBtn, !redoStack.current.length && { opacity: 0.3 }]}
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
            onAddItem={onAddItem}
            onEraseAt={onEraseAt}
            onEraseEnd={onEraseEnd}
            onTextTap={onTextTap}
            onCurrentPage={setCurPage}
          />
        ) : (
          <View style={styles.center}>
            <ActivityIndicator color={theme.primary} />
          </View>
        )}
        {doc ? (
          <View style={styles.pageChip} pointerEvents="none">
            <Text style={styles.pageChipText}>
              {Math.min(curPage + 1, doc.pages.length)} / {doc.pages.length}
            </Text>
          </View>
        ) : null}
        {busy ? (
          <View style={styles.busy}>
            <ActivityIndicator color="#fff" />
            <Text style={{ color: '#fff', marginTop: 10 }}>{busy}</Text>
          </View>
        ) : null}
      </View>

      <Toolbar
        tool={tool}
        onTool={setTool}
        color={activeColor}
        onColor={setActiveColor}
        size={activeSize}
        onSize={(s) => setSizes((prev) => ({ ...prev, [tool]: s }))}
        shape={shape}
        onShape={setShape}
      />

      <SheetMenu visible={menu} items={menuItems} onClose={() => setMenu(false)} />
      <SheetMenu visible={paperMenu} title={t('paper')} items={paperItems} onClose={() => setPaperMenu(false)} />
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

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.surface },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, backgroundColor: theme.bg },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 6,
    paddingVertical: 4,
    backgroundColor: theme.surface,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: theme.border,
  },
  iconBtn: { width: 42, height: 42, alignItems: 'center', justifyContent: 'center', borderRadius: 21 },
  iconText: { fontSize: 24, color: theme.text },
  title: { fontSize: 16.5, fontWeight: '700', color: theme.text, paddingHorizontal: 6 },
  pageChip: {
    position: 'absolute',
    left: 12,
    bottom: 12,
    backgroundColor: 'rgba(27,29,42,0.78)',
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 5,
  },
  pageChipText: { color: '#fff', fontSize: 13, fontWeight: '600' },
  busy: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.5)', alignItems: 'center', justifyContent: 'center' },
  backBtn: { marginTop: 18, backgroundColor: theme.primary, borderRadius: 12, paddingHorizontal: 22, paddingVertical: 10 },
});
