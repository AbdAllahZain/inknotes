import React, { useEffect, useRef, useState } from 'react';
import {
  FlatList,
  Image,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { t } from '../i18n';
import { pageThumbUri } from '../services/media';
import { Palette, useStyles } from '../appTheme';
import { Doc, Page, PageBg, PAPER_CHOICES } from '../types';
import { SheetItem, SheetMenu } from '../ui/SheetMenu';

type Props = {
  visible: boolean;
  doc: Doc;
  current: number;
  onClose: () => void;
  onGoto: (index: number) => void;
  onMove: (from: number, to: number) => void;
  onDuplicate: (index: number) => void;
  onDelete: (index: number) => void;
  onInsert: (index: number, bg: PageBg) => void;
};

function Thumb({ doc, page, w, h }: { doc: Doc; page: Page; w: number; h: number }) {
  const styles = useStyles(makeStyles);
  const [uri, setUri] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    setUri(null);
    pageThumbUri(doc, page)
      .then((u) => alive && setUri(u))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [page]); // eslint-disable-line react-hooks/exhaustive-deps
  return uri ? (
    <Image source={{ uri }} style={{ width: w, height: h, borderRadius: 4 }} resizeMode="cover" />
  ) : (
    <View style={[styles.placeholder, { width: w, height: h }]} />
  );
}

/** Thumbnails grid: jump to a page, reorder, duplicate, insert and delete pages. */
export function PagesManager(p: Props) {
  const styles = useStyles(makeStyles);
  const { width } = useWindowDimensions();
  const cols = width >= 900 ? 5 : width >= 600 ? 4 : 3;
  const cellW = (width - 16 * (cols + 1)) / cols;
  const thumbH = cellW * 1.414;
  const rowH = thumbH + 16 + 30;
  const [sel, setSel] = useState(p.current);
  const [paperOpen, setPaperOpen] = useState(false);
  const listRef = useRef<FlatList<Page>>(null);

  useEffect(() => {
    if (!p.visible) return;
    setSel(Math.min(p.current, p.doc.pages.length - 1));
    const t0 = setTimeout(() => {
      listRef.current?.scrollToOffset({ offset: Math.max(0, Math.floor(p.current / cols) * rowH - 20), animated: false });
    }, 80);
    return () => clearTimeout(t0);
  }, [p.visible]); // eslint-disable-line react-hooks/exhaustive-deps

  const n = p.doc.pages.length;
  const safeSel = Math.min(sel, n - 1);

  const paperItems: SheetItem[] = PAPER_CHOICES.map((bg) => ({
    key: bg,
    label: t(bg as 'blank'),
    onPress: () => p.onInsert(safeSel, bg),
  }));

  return (
    <Modal visible={p.visible} animationType="slide" onRequestClose={p.onClose}>
      <SafeAreaView style={styles.root}>
        <View style={styles.top}>
          <Pressable onPress={p.onClose} style={styles.closeBtn} hitSlop={8}>
            <Text style={styles.closeText}>✕</Text>
          </Pressable>
          <Text style={styles.title}>
            {t('managePages')} · {n}
          </Text>
        </View>
        <FlatList
          ref={listRef}
          data={p.doc.pages}
          key={cols}
          numColumns={cols}
          keyExtractor={(pg) => pg.id}
          contentContainerStyle={{ padding: 8, paddingBottom: 24 }}
          initialNumToRender={cols * 3}
          windowSize={7}
          renderItem={({ item, index }) => (
            <Pressable
              onPress={() => setSel(index)}
              onLongPress={() => {
                p.onGoto(index);
                p.onClose();
              }}
              style={[styles.cell, { width: cellW, height: rowH - 16, margin: 8 }, index === safeSel && styles.cellOn]}
            >
              <Thumb doc={p.doc} page={item} w={cellW - 6} h={thumbH} />
              <Text style={[styles.num, index === p.current && styles.numCurrent]}>
                {index + 1}
                {item.bg === 'pdf' && item.items.length ? '  ✎' : ''}
              </Text>
            </Pressable>
          )}
        />
        <View style={styles.bar}>
          <Pressable
            onPress={() => {
              p.onGoto(safeSel);
              p.onClose();
            }}
            style={[styles.act, styles.actPrimary]}
          >
            <Text style={[styles.actText, styles.actPrimaryText]}>{t('openPage')}</Text>
          </Pressable>
          <Pressable
            disabled={safeSel <= 0}
            onPress={() => {
              p.onMove(safeSel, safeSel - 1);
              setSel(safeSel - 1);
            }}
            style={[styles.act, safeSel <= 0 && styles.disabled]}
          >
            <Text style={styles.actText}>◀ {t('moveEarlier')}</Text>
          </Pressable>
          <Pressable
            disabled={safeSel >= n - 1}
            onPress={() => {
              p.onMove(safeSel, safeSel + 1);
              setSel(safeSel + 1);
            }}
            style={[styles.act, safeSel >= n - 1 && styles.disabled]}
          >
            <Text style={styles.actText}>{t('moveLater')} ▶</Text>
          </Pressable>
          <Pressable onPress={() => p.onDuplicate(safeSel)} style={styles.act}>
            <Text style={styles.actText}>⧉ {t('duplicatePage')}</Text>
          </Pressable>
          <Pressable onPress={() => setPaperOpen(true)} style={styles.act}>
            <Text style={styles.actText}>＋ {t('insertPage')}</Text>
          </Pressable>
          <Pressable
            disabled={n <= 1}
            onPress={() => p.onDelete(safeSel)}
            style={[styles.act, n <= 1 && styles.disabled]}
          >
            <Text style={[styles.actText, styles.danger]}>🗑 {t('delete')}</Text>
          </Pressable>
        </View>
        <SheetMenu visible={paperOpen} title={t('pickPaperForNew')} items={paperItems} onClose={() => setPaperOpen(false)} />
      </SafeAreaView>
    </Modal>
  );
}

const makeStyles = (th: Palette) =>
  StyleSheet.create({
    root: { flex: 1, backgroundColor: th.bg },
    top: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 10, gap: 12 },
    closeBtn: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: th.surfaceAlt },
    closeText: { fontSize: 18, color: th.text },
    title: { fontSize: 18, fontWeight: '800', color: th.text },
    cell: { backgroundColor: th.surface, borderRadius: 12, padding: 3, borderWidth: 2, borderColor: 'transparent', alignItems: 'center' },
    cellOn: { borderColor: th.primary },
    placeholder: { backgroundColor: th.surfaceAlt, borderRadius: 4 },
    num: { marginTop: 4, fontSize: 13, fontWeight: '700', color: th.textDim },
    numCurrent: { color: th.primary },
    bar: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 8,
      padding: 10,
      backgroundColor: th.surface,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: th.border,
      justifyContent: 'center',
    },
    act: { paddingHorizontal: 14, paddingVertical: 9, borderRadius: 12, backgroundColor: th.surfaceAlt },
    actText: { fontSize: 14, fontWeight: '700', color: th.text },
    actPrimary: { backgroundColor: th.primary },
    actPrimaryText: { color: th.primaryText },
    disabled: { opacity: 0.35 },
    danger: { color: th.danger },
  });
