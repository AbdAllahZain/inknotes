import * as FileSystem from 'expo-file-system';
import { strFromU8, strToU8, unzipSync, zipSync, type Zippable } from 'fflate';
import type { DocMeta, Folder } from '../types';
import { base64ToBytes, bytesToBase64 } from './b64';
import { createFolder, docDir, ensureDir, listFolders, readIndex, uid, writeIndex } from './storage';

const B64 = { encoding: FileSystem.EncodingType.Base64 };

/** Packs every note and PDF (with its annotations and pictures) into one ZIP file. */
export async function createBackup(): Promise<string> {
  const index = await readIndex();
  const folders = await listFolders();
  const files: Zippable = {};
  for (const meta of index) {
    const dir = docDir(meta.id);
    let names: string[] = [];
    try {
      names = await FileSystem.readDirectoryAsync(dir);
    } catch {
      continue;
    }
    for (const name of names) {
      if (name === 'thumb.jpg') continue;
      const bytes = base64ToBytes(await FileSystem.readAsStringAsync(dir + name, B64));
      files['docs/' + meta.id + '/' + name] = [bytes, { level: name.endsWith('.json') ? 6 : 0 }];
    }
  }
  const manifest = {
    app: 'inknotes',
    version: 1,
    createdAt: Date.now(),
    docs: index.map((m) => ({ ...m, thumb: undefined })),
    folders,
  };
  files['manifest.json'] = strToU8(JSON.stringify(manifest));
  const zip = zipSync(files);
  const day = new Date().toISOString().slice(0, 10);
  const path = FileSystem.cacheDirectory + 'InkNotes-backup-' + day + '.zip';
  await FileSystem.writeAsStringAsync(path, bytesToBase64(zip), B64);
  return path;
}

/** Restores a backup ZIP. Files are added as new documents, nothing existing is overwritten. */
export async function restoreBackup(uri: string): Promise<number> {
  const zip = unzipSync(base64ToBytes(await FileSystem.readAsStringAsync(uri, B64)));
  const mf = zip['manifest.json'];
  if (!mf) throw new Error('not a backup');
  const manifest = JSON.parse(strFromU8(mf)) as { app?: string; docs?: DocMeta[]; folders?: Folder[] };
  if (manifest.app !== 'inknotes' || !Array.isArray(manifest.docs)) throw new Error('not an InkNotes backup');

  // folders: reuse a folder with the same name, otherwise create it
  const existing = await listFolders();
  const folderMap = new Map<string, string>();
  for (const f of manifest.folders ?? []) {
    const same = existing.find((e) => e.name === f.name);
    folderMap.set(f.id, same ? same.id : (await createFolder(f.name)).id);
  }

  const index = await readIndex();
  let count = 0;
  for (const meta of manifest.docs) {
    const prefix = 'docs/' + meta.id + '/';
    const newId = uid();
    const dir = docDir(newId);
    await ensureDir(dir);
    let hasDoc = false;
    for (const path of Object.keys(zip)) {
      if (!path.startsWith(prefix)) continue;
      const name = path.slice(prefix.length);
      if (!name || name.includes('/') || name.includes('..')) continue;
      await FileSystem.writeAsStringAsync(dir + name, bytesToBase64(zip[path]), B64);
      if (name === 'doc.json') hasDoc = true;
    }
    if (!hasDoc) {
      await FileSystem.deleteAsync(dir, { idempotent: true });
      continue;
    }
    const doc = JSON.parse(await FileSystem.readAsStringAsync(dir + 'doc.json'));
    doc.id = newId;
    await FileSystem.writeAsStringAsync(dir + 'doc.json', JSON.stringify(doc));
    index.push({
      ...meta,
      id: newId,
      thumb: undefined,
      folder: meta.folder ? folderMap.get(meta.folder) : undefined,
    });
    count++;
  }
  await writeIndex(index);
  return count;
}
