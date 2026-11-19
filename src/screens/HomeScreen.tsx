import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import * as DocumentPicker from 'expo-document-picker';
import * as LocalAuthentication from 'expo-local-authentication';
import * as Sharing from 'expo-sharing';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { locale, t } from '../i18n';
import type { RootStackParamList } from '../navigation';
import { createBackup, restoreBackup } from '../services/backup';
import { clearLastError, readLastError } from '../services/crashLog';
import {
  createFolder,
  createNote,
  deleteDoc,
  deleteFolder,
  importPdf,
  listDocs,
  listFolders,
  loadDoc,
  renameFolder,
  saveDoc,
  setDocFolder,
  setDocTags,
} from '../services/storage';
import { useSettings } from '../settings';
import { Palette, useStyles, useTheme } from '../appTheme';
import { DocMeta, Folder, PageBg, PAPER_CHOICES, ThemeMode } from '../types';
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
  const th = useTheme();
  const styles = useStyles(makeStyles);
  const { settings, update } = useSettings();
  const { width } = useWindowDimensions();
  const cols = width >= 1000 ? 5 : width >= 700 ? 4 : width >= 480 ? 3 : 2;

  const [docs, setDocs] = useState<DocMeta[]>([]);
  const [folders, setFolders] = useState<Folder[]>([]);
  const [folderFilter, setFolderFilter] = useState<string>('all');
  const [tagFilter, setTagFilter] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [paperOpen, setPaperOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [selected, setSelected] = useState<DocMeta | null>(null);
  const [renaming, setRenaming] = useState<DocMeta | null>(null);
  const [tagsFor, setTagsFor] = useState<DocMeta | null>(null);
  const [moveFor, setMoveFor] = useState<DocMeta | null>(null);
  const [folderPrompt, setFolderPrompt] = useState<{ folder?: Folder } | null>(null);
  const [folderMenu, setFolderMenu] = useState<Folder | null>(null);
  const [lastError, setLastError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setDocs(await listDocs());
    setFolders(await listFolders());
    setLastError(await readLastError());
  }, []);

  useEffect(() => {
    refresh();
    const unsub = navigation.addListener('focus', refresh);
    return unsub;
  }, [navigation, refresh]);

  const allTags = useMemo(() => {
    const set = new Set<string>();
    docs.forEach((d) => d.tags?.forEach((x) => set.add(x)));
    return Array.from(set).sort();
  }, [docs]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return docs.filter((d) => {
      if (folderFilter !== 'all' && d.folder !== folderFilter) return false;
      if (tagFilter && !(d.tags ?? []).includes(tagFilter)) return false;
      if (!q) return true;
      return d.title.toLowerCase().includes(q) || (d.tags ?? []).some((x) => x.toLowerCase().includes(q));
    });
  }, [docs, query, folderFilter, tagFilter]);

  const newNote = async (bg: PageBg) => {
    setBusy(t('loading'));
    try {
      const doc = await createNote(t('note') + ' ' + fmtDate(Date.now()), bg);
      navigation.navigate('Editor', { docId: doc.id });
    } finally {
      setBusy(null);
    }
  };

  const pickPdf = async () => {
    const res = await DocumentPicker.getDocumentAsync({ type: 'application/pdf', copyToCacheDirectory: true });
    if (res.canceled || !res.assets?.length) return;
    const a = res.assets[0];
    setBusy(t('loading'));
    try {
      const doc = await importPdf(a.uri, a.name ?? 'document.pdf');
      if (folderFilter !== 'all') await setDocFolder(doc.id, folderFilter);
      navigation.navigate('Editor', { docId: doc.id });
    } catch {
      Alert.alert(t('pdfFailed'));
    } finally {
      setBusy(null);
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

  const saveFolder = async (name: string) => {
    const fp = folderPrompt;
    setFolderPrompt(null);
    if (!name.trim()) return;
    if (fp?.folder) await renameFolder(fp.folder.id, name);
    else {
      const f = await createFolder(name);
      setFolderFilter(f.id);
    }
    refresh();
  };

  const confirmDeleteFolder = (f: Folder) => {
    Alert.alert(f.name, t('confirmDeleteFolder'), [
      { text: t('cancel'), style: 'cancel' },
      {
        text: t('delete'),
        style: 'destructive',
        onPress: async () => {
          await deleteFolder(f.id);
          if (folderFilter === f.id) setFolderFilter('all');
          refresh();
        },
      },
    ]);
  };

  // ---- settings actions ---------------------------------------------------
  const authenticate = async (): Promise<boolean> => {
    try {
      const res = await LocalAuthentication.authenticateAsync({ promptMessage: t('authReason'), cancelLabel: t('cancel') });
      return res.success;
    } catch {
      return false;
    }
  };

  const toggleLock = async () => {
    if (settings.appLock) {
      if (await authenticate()) update({ appLock: false });
      return;
    }
    const hw = await LocalAuthentication.hasHardwareAsync();
    const enrolled = await LocalAuthentication.isEnrolledAsync();
    const levelOk = (await LocalAuthentication.getEnrolledLevelAsync()) !== LocalAuthentication.SecurityLevel.NONE;
    if (!(hw && enrolled) && !levelOk) {
      Alert.alert(t('noBiometric'));
      return;
    }
    if (await authenticate()) update({ appLock: true });
  };

  const doBackup = async () => {
    setBusy(t('backupCreating'));
    try {
      const path = await createBackup();
      if (await Sharing.isAvailableAsync()) await Sharing.shareAsync(path, { mimeType: 'application/zip', dialogTitle: t('backup') });
    } catch (e) {
      Alert.alert(t('backupFailed'), String((e as Error)?.message ?? e));
    } finally {
      setBusy(null);
    }
  };

  const doRestore = async () => {
    const res = await DocumentPicker.getDocumentAsync({ type: '*/*', copyToCacheDirectory: true });
    if (res.canceled || !res.assets?.length) return;
    setBusy(t('restoring'));
    try {
      const n = await restoreBackup(res.assets[0].uri);
      await refresh();
      Alert.alert(t('restoreDone') + ' ' + n);
    } catch {
      Alert.alert(t('restoreFailed'));
    } finally {
      setBusy(null);
    }
  };

  const setMode = (m: ThemeMode) => update({ themeMode: m });

  const settingsItems: SheetItem[] = [
    { key: 'h1', header: true, label: t('theme') },
    { key: 'sys', icon: '◐', label: t('themeSystem'), checked: settings.themeMode === 'system', keepOpen: true, onPress: () => setMode('system') },
    { key: 'light', icon: '☀', label: t('themeLight'), checked: settings.themeMode === 'light', keepOpen: true, onPress: () => setMode('light') },
    { key: 'dark', icon: '☾', label: t('themeDark'), checked: settings.themeMode === 'dark', keepOpen: true, onPress: () => setMode('dark') },
    { key: 'h2', header: true, label: t('appLock') },
    { key: 'lock', icon: '🔒', label: t('appLock'), hint: t('appLockHint'), checked: settings.appLock, keepOpen: true, onPress: toggleLock },
    { key: 'h3', header: true, label: t('myNotes') },
    {
      key: 'stylus',
      icon: '✍',
      label: t('stylusOnly'),
      hint: t('stylusOnlyHint'),
      checked: settings.stylusOnly,
      keepOpen: true,
      onPress: () => update({ stylusOnly: !settings.stylusOnly }),
    },
    { key: 'h4', header: true, label: t('backup') },
    { key: 'backup', icon: '⇪', label: t('backup'), hint: t('backupHint'), onPress: doBackup },
    { key: 'restore', icon: '⇩', label: t('restore'), onPress: doRestore },
  ];

  const paperItems: SheetItem[] = PAPER_CHOICES.map((bg) => ({
    key: bg,
    label: t(bg as 'blank'),
    onPress: () => newNote(bg),
  }));

  const selItems: SheetItem[] = selected
    ? [
        { key: 'rename', icon: '✎', label: t('rename'), onPress: () => setRenaming(selected) },
        { key: 'move', icon: '🗀', label: t('moveToFolder'), onPress: () => setMoveFor(selected) },
        { key: 'tags', icon: '#', label: t('editTags'), onPress: () => setTagsFor(selected) },
        { key: 'delete', icon: '🗑', label: t('delete'), danger: true, onPress: () => confirmDelete(selected) },
      ]
    : [];

  const moveItems: SheetItem[] = moveFor
    ? [
        {
          key: 'none',
          icon: '∅',
          label: t('noFolder'),
          checked: !moveFor.folder,
          onPress: async () => {
            await setDocFolder(moveFor.id, undefined);
            refresh();
          },
        },
        ...folders.map((f) => ({
          key: f.id,
          icon: '🗀',
          label: f.name,
          checked: moveFor.folder === f.id,
          onPress: async () => {
            await setDocFolder(moveFor.id, f.id);
            refresh();
          },
        })),
      ]
    : [];

  const folderMenuItems: SheetItem[] = folderMenu
    ? [
        { key: 'ren', icon: '✎', label: t('renameFolder'), onPress: () => setFolderPrompt({ folder: folderMenu }) },
        { key: 'del', icon: '🗑', label: t('deleteFolder'), danger: true, onPress: () => confirmDeleteFolder(folderMenu) },
      ]
    : [];

  const cardW = (width - 16 * (cols + 1)) / cols;
  const folderName = (id?: string) => folders.find((f) => f.id === id)?.name;

  return (
    <SafeAreaView style={styles.root} edges={['top', 'left', 'right']}>
      <StatusBar style={th.isDark ? 'light' : 'dark'} />
      <View style={styles.header}>
        <View style={styles.titleRow}>
          <Text style={styles.h1}>{t('appName')}</Text>
          <Pressable onPress={() => setSettingsOpen(true)} style={styles.gear} hitSlop={8}>
            <Text style={styles.gearText}>⚙</Text>
          </Pressable>
        </View>
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder={t('search')}
          placeholderTextColor={th.textDim}
          style={styles.search}
        />
      </View>

      <View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
          <Pressable onPress={() => setFolderFilter('all')} style={[styles.chip, folderFilter === 'all' && styles.chipOn]}>
            <Text style={[styles.chipText, folderFilter === 'all' && styles.chipTextOn]}>{t('allFiles')}</Text>
          </Pressable>
          {folders.map((f) => (
            <Pressable
              key={f.id}
              onPress={() => setFolderFilter(f.id)}
              onLongPress={() => setFolderMenu(f)}
              style={[styles.chip, folderFilter === f.id && styles.chipOn]}
            >
              <Text style={[styles.chipText, folderFilter === f.id && styles.chipTextOn]}>🗀 {f.name}</Text>
            </Pressable>
          ))}
          <Pressable onPress={() => setFolderPrompt({})} style={[styles.chip, styles.chipAdd]}>
            <Text style={styles.chipText}>＋ {t('newFolder')}</Text>
          </Pressable>
        </ScrollView>
        {allTags.length ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
            {allTags.map((tg) => (
              <Pressable
                key={tg}
                onPress={() => setTagFilter(tagFilter === tg ? null : tg)}
                style={[styles.tagChip, tagFilter === tg && styles.chipOn]}
              >
                <Text style={[styles.tagText, tagFilter === tg && styles.chipTextOn]}># {tg}</Text>
              </Pressable>
            ))}
          </ScrollView>
        ) : null}
      </View>

      {lastError ? (
        <View style={styles.errBox}>
          <Text style={styles.errTitle}>{t('lastError')}</Text>
          <Text selectable style={styles.errText}>
            {lastError}
          </Text>
          <Pressable
            onPress={async () => {
              await clearLastError();
              setLastError(null);
            }}
            style={styles.errBtn}
          >
            <Text style={{ color: '#fff', fontWeight: '700' }}>{t('dismiss')}</Text>
          </Pressable>
        </View>
      ) : null}

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
            {item.folder || item.tags?.length ? (
              <Text numberOfLines={1} style={styles.cardTags}>
                {[folderName(item.folder) ? '🗀 ' + folderName(item.folder) : '', ...(item.tags ?? []).map((x) => '#' + x)]
                  .filter(Boolean)
                  .join('  ')}
              </Text>
            ) : null}
          </Pressable>
        )}
      />

      <View style={styles.fabRow} pointerEvents="box-none">
        <Pressable onPress={pickPdf} style={[styles.fab, styles.fabSecondary]}>
          <Text style={[styles.fabText, { color: th.primary }]}>📄  {t('openPdf')}</Text>
        </Pressable>
        <Pressable onPress={() => setPaperOpen(true)} style={styles.fab}>
          <Text style={styles.fabText}>＋  {t('newNote')}</Text>
        </Pressable>
      </View>

      {busy ? (
        <View style={styles.busy}>
          <ActivityIndicator color="#fff" size="large" />
          <Text style={{ color: '#fff', marginTop: 10 }}>{busy}</Text>
        </View>
      ) : null}

      <SheetMenu visible={paperOpen} title={t('choosePaper')} items={paperItems} onClose={() => setPaperOpen(false)} />
      <SheetMenu visible={settingsOpen} title={t('settings')} items={settingsItems} onClose={() => setSettingsOpen(false)} />
      <SheetMenu visible={!!selected} title={selected?.title} items={selItems} onClose={() => setSelected(null)} />
      <SheetMenu visible={!!moveFor} title={t('moveToFolder')} items={moveItems} onClose={() => setMoveFor(null)} />
      <SheetMenu visible={!!folderMenu} title={folderMenu?.name} items={folderMenuItems} onClose={() => setFolderMenu(null)} />
      <PromptModal
        visible={!!renaming}
        title={t('rename')}
        initial={renaming?.title}
        onCancel={() => setRenaming(null)}
        onOk={doRename}
      />
      <PromptModal
        visible={!!folderPrompt}
        title={folderPrompt?.folder ? t('renameFolder') : t('newFolder')}
        initial={folderPrompt?.folder?.name ?? ''}
        placeholder={t('folderName')}
        onCancel={() => setFolderPrompt(null)}
        onOk={saveFolder}
      />
      <PromptModal
        visible={!!tagsFor}
        title={t('editTags')}
        initial={(tagsFor?.tags ?? []).join(', ')}
        placeholder={t('tagsHint')}
        onCancel={() => setTagsFor(null)}
        onOk={async (v) => {
          const d = tagsFor;
          setTagsFor(null);
          if (!d) return;
          await setDocTags(d.id, v.split(/[,،]/));
          refresh();
        }}
      />
    </SafeAreaView>
  );
}

const makeStyles = (th: Palette) =>
  StyleSheet.create({
    root: { flex: 1, backgroundColor: th.bg },
    header: { paddingHorizontal: 16, paddingTop: 10, paddingBottom: 6 },
    titleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 },
    h1: { fontSize: 28, fontWeight: '800', color: th.text },
    gear: { width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center', backgroundColor: th.surface },
    gearText: { fontSize: 22, color: th.text },
    search: {
      backgroundColor: th.surface,
      borderRadius: 14,
      paddingHorizontal: 14,
      paddingVertical: 10,
      fontSize: 15,
      color: th.text,
      borderWidth: 1,
      borderColor: th.border,
    },
    chips: { paddingHorizontal: 12, paddingVertical: 6, gap: 8, alignItems: 'center' },
    chip: { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 16, backgroundColor: th.surface, borderWidth: 1, borderColor: th.border },
    chipAdd: { borderStyle: 'dashed' },
    chipOn: { backgroundColor: th.primary, borderColor: th.primary },
    chipText: { fontSize: 13.5, fontWeight: '700', color: th.text },
    chipTextOn: { color: th.primaryText },
    tagChip: { paddingHorizontal: 11, paddingVertical: 4, borderRadius: 12, backgroundColor: th.chip },
    tagText: { fontSize: 12.5, fontWeight: '700', color: th.primary },
    empty: { textAlign: 'center', color: th.textDim, marginTop: 80, lineHeight: 24, fontSize: 15 },
    card: { backgroundColor: th.surface, borderRadius: 16, padding: 8, elevation: 2 },
    thumb: { borderRadius: 10, overflow: 'hidden', backgroundColor: th.surfaceAlt },
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
    cardTitle: { fontSize: 14.5, fontWeight: '700', color: th.text, marginTop: 8 },
    cardSub: { fontSize: 12, color: th.textDim, marginTop: 2 },
    cardTags: { fontSize: 11.5, color: th.primary, marginTop: 3, fontWeight: '600' },
    fabRow: { position: 'absolute', left: 0, right: 0, bottom: 22, flexDirection: 'row', justifyContent: 'center', gap: 12 },
    fab: { backgroundColor: th.primary, paddingHorizontal: 20, paddingVertical: 14, borderRadius: 28, elevation: 5 },
    fabSecondary: { backgroundColor: th.surface, borderWidth: 1.5, borderColor: th.primary },
    fabText: { color: '#fff', fontSize: 15, fontWeight: '700' },
    errBox: { margin: 12, padding: 12, borderRadius: 12, backgroundColor: '#FEF2F2', borderWidth: 1, borderColor: '#FCA5A5' },
    errTitle: { fontWeight: '800', color: '#B91C1C', marginBottom: 4 },
    errText: { fontFamily: 'monospace', fontSize: 11, color: '#7F1D1D' },
    errBtn: { alignSelf: 'flex-start', marginTop: 8, backgroundColor: '#B91C1C', borderRadius: 10, paddingHorizontal: 14, paddingVertical: 6 },
    busy: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.5)', alignItems: 'center', justifyContent: 'center' },
  });
