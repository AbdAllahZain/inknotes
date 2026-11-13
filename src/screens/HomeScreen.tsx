import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Image,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import * as DocumentPicker from 'expo-document-picker';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { locale, t } from '../i18n';
import type { RootStackParamList } from '../navigation';
import { createNote, deleteDoc, importPdf, listDocs, loadDoc, saveDoc } from '../services/storage';
import { theme } from '../theme';
import type { DocMeta, PageBg } from '../types';
import { PromptModal } from '../ui/PromptModal';
import { SheetItem, SheetMenu } from '../ui/SheetMenu';

type Props = NativeStackScreenProps<RootStackParamList, 'Home'>;

function fmtDate(ts: number): string {
  try {
    return new Date(ts).toLocaleDateString(locale.replace('_', '-'));
  } catch {
    return new Date(ts).toISOString().slice(0, 10);
  }
}

export function HomeScreen({ navigation }: Props) {
  const { width } = useWindowDimensions();
  const cols = width >= 1000 ? 5 : width >= 700 ? 4 : width >= 480 ? 3 : 2;
  const [docs, setDocs] = useState<DocMeta[]>([]);
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState(false);
  const [paperOpen, setPaperOpen] = useState(false);
  const [selected, setSelected] = useState<DocMeta | null>(null);
  const [renaming, setRenaming] = useState<DocMeta | null>(null);

  const refresh = useCallback(async () => {
    setDocs(await listDocs());
  }, []);

  useEffect(() => {
    refresh();
    const unsub = navigation.addListener('focus', refresh);
    return unsub;
  }, [navigation, refresh]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? docs.filter((d) => d.title.toLowerCase().includes(q)) : docs;
  }, [docs, query]);

  const newNote = async (bg: PageBg) => {
    setBusy(true);
    try {
      const title = t('note') + ' ' + fmtDate(Date.now());
      const doc = await createNote(title, bg);
      navigation.navigate('Editor', { docId: doc.id });
    } finally {
      setBusy(false);
    }
  };

  const pickPdf = async () => {
    const res = await DocumentPicker.getDocumentAsync({ type: 'application/pdf', copyToCacheDirectory: true });
    if (res.canceled || !res.assets?.length) return;
    const a = res.assets[0];
    setBusy(true);
    try {
      const doc = await importPdf(a.uri, a.name ?? 'document.pdf');
      navigation.navigate('Editor', { docId: doc.id });
    } catch {
      Alert.alert(t('pdfFailed'));
    } finally {
      setBusy(false);
    }
  };

  const confirmDelete = (d: DocMeta) => {
    Alert.alert(d.title, t('confirmDelete'), [
      { text: t('cancel'), style: 'cancel' },
      {
        text: t('delete'),
        style: 'destructive',
        onPress: async () => {
          await deleteDoc(d.id);
          refresh();
        },
      },
    ]);
  };

  const doRename = async (title: string) => {
    const d = renaming;
    setRenaming(null);
    if (!d || !title.trim()) return;
    const full = await loadDoc(d.id);
    full.title = title.trim();
    await saveDoc(full);
    refresh();
  };

  const paperItems: SheetItem[] = (['blank', 'lined', 'grid', 'dots'] as PageBg[]).map((bg) => ({
    key: bg,
    label: t(bg as 'blank'),
    onPress: () => newNote(bg),
  }));

  const selItems: SheetItem[] = selected
    ? [
        { key: 'rename', icon: '✎', label: t('rename'), onPress: () => setRenaming(selected) },
        { key: 'delete', icon: '🗑', label: t('delete'), danger: true, onPress: () => confirmDelete(selected) },
      ]
    : [];

  const cardW = (width - 16 * (cols + 1)) / cols;

  return (
    <SafeAreaView style={styles.root} edges={['top', 'left', 'right']}>
      <StatusBar style="dark" />
      <View style={styles.header}>
        <Text style={styles.h1}>{t('appName')}</Text>
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder={t('search')}
          placeholderTextColor={theme.textDim}
          style={styles.search}
        />
      </View>

      <FlatList
        key={cols}
        data={filtered}
        numColumns={cols}
        keyExtractor={(d) => d.id}
        contentContainerStyle={{ padding: 8, paddingBottom: 110 }}
        ListEmptyComponent={<Text style={styles.empty}>{t('empty')}</Text>}
        renderItem={({ item }) => (
          <Pressable
            onPress={() => navigation.navigate('Editor', { docId: item.id })}
            onLongPress={() => setSelected(item)}
            style={[styles.card, { width: cardW, margin: 8 }]}
          >
            <View style={[styles.thumb, { height: cardW * 1.25 }]}>
              {item.type === 'pdf' && item.thumb ? (
                <Image source={{ uri: item.thumb }} style={StyleSheet.absoluteFill} resizeMode="cover" />
              ) : (
                <View style={styles.paperIcon}>
                  <Text style={{ fontSize: 34 }}>{item.type === 'pdf' ? '📄' : '📝'}</Text>
                </View>
              )}
              <View style={styles.badge}>
                <Text style={styles.badgeText}>{item.type === 'pdf' ? t('pdf') : t('note')}</Text>
              </View>
            </View>
            <Text numberOfLines={1} style={styles.cardTitle}>
              {item.title}
            </Text>
            <Text numberOfLines={1} style={styles.cardSub}>
              {item.pageCount} {t('pages')} · {fmtDate(item.updatedAt)}
            </Text>
          </Pressable>
        )}
      />

      <View style={styles.fabRow} pointerEvents="box-none">
        <Pressable onPress={pickPdf} style={[styles.fab, styles.fabSecondary]}>
          <Text style={[styles.fabText, { color: theme.primary }]}>📄  {t('openPdf')}</Text>
        </Pressable>
        <Pressable onPress={() => setPaperOpen(true)} style={styles.fab}>
          <Text style={styles.fabText}>＋  {t('newNote')}</Text>
        </Pressable>
      </View>

      {busy ? (
        <View style={styles.busy}>
          <ActivityIndicator color="#fff" size="large" />
        </View>
      ) : null}

      <SheetMenu visible={paperOpen} title={t('choosePaper')} items={paperItems} onClose={() => setPaperOpen(false)} />
      <SheetMenu visible={!!selected} title={selected?.title} items={selItems} onClose={() => setSelected(null)} />
      <PromptModal
        visible={!!renaming}
        title={t('rename')}
        initial={renaming?.title}
        onCancel={() => setRenaming(null)}
        onOk={doRename}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.bg },
  header: { paddingHorizontal: 16, paddingTop: 10, paddingBottom: 6 },
  h1: { fontSize: 28, fontWeight: '800', color: theme.text, marginBottom: 10 },
  search: {
    backgroundColor: theme.surface,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 15,
    color: theme.text,
    borderWidth: 1,
    borderColor: theme.border,
  },
  empty: { textAlign: 'center', color: theme.textDim, marginTop: 80, lineHeight: 24, fontSize: 15 },
  card: { backgroundColor: theme.surface, borderRadius: 16, padding: 8, elevation: 2 },
  thumb: { borderRadius: 10, overflow: 'hidden', backgroundColor: theme.surfaceAlt },
  paperIcon: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  badge: {
    position: 'absolute',
    top: 6,
    left: 6,
    backgroundColor: 'rgba(79,70,229,0.92)',
    borderRadius: 8,
    paddingHorizontal: 7,
    paddingVertical: 2,
  },
  badgeText: { color: '#fff', fontSize: 11, fontWeight: '700' },
  cardTitle: { fontSize: 14.5, fontWeight: '700', color: theme.text, marginTop: 8 },
  cardSub: { fontSize: 12, color: theme.textDim, marginTop: 2 },
  fabRow: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 22,
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 12,
  },
  fab: {
    backgroundColor: theme.primary,
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderRadius: 28,
    elevation: 5,
  },
  fabSecondary: { backgroundColor: theme.surface, borderWidth: 1.5, borderColor: theme.primary },
  fabText: { color: '#fff', fontSize: 15, fontWeight: '700' },
  busy: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.45)', alignItems: 'center', justifyContent: 'center' },
});
