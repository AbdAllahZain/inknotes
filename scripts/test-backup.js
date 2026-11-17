// Round-trip test of backup + restore against a real temp directory (expo-file-system is mocked with node:fs).
require('./ts-require');
const fs = require('fs'), path = require('path'), os = require('os'), Module = require('module');
const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'ink-'));
const DOC = ROOT + '/documents/', CACHE = ROOT + '/cache/';
fs.mkdirSync(DOC, { recursive: true }); fs.mkdirSync(CACHE, { recursive: true });

const FileSystemMock = {
  documentDirectory: DOC, cacheDirectory: CACHE, EncodingType: { Base64: 'base64', UTF8: 'utf8' },
  getInfoAsync: async (p) => ({ exists: fs.existsSync(p) }),
  makeDirectoryAsync: async (p) => fs.mkdirSync(p, { recursive: true }),
  readAsStringAsync: async (p, o) => fs.readFileSync(p).toString(o && o.encoding === 'base64' ? 'base64' : 'utf8'),
  writeAsStringAsync: async (p, s, o) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, Buffer.from(s, o && o.encoding === 'base64' ? 'base64' : 'utf8')); },
  deleteAsync: async (p) => fs.rmSync(p, { recursive: true, force: true }),
  copyAsync: async ({ from, to }) => fs.copyFileSync(from, to),
  readDirectoryAsync: async (p) => fs.readdirSync(p),
};
const stubs = {
  'expo-file-system': FileSystemMock,
  'react-native': { Dimensions: { get: () => ({ width: 1080 }) }, PixelRatio: { get: () => 2 }, NativeModules: {} },
  './pdfNative': { getPdfPageSizes: async () => [], renderPdfPage: async () => ({}) },
};
const orig = Module._load;
Module._load = function (request, parent, isMain) { return stubs[request] ? stubs[request] : orig.apply(this, arguments); };

const S = require('../src/services/storage.ts');
const B = require('../src/services/backup.ts');
const assert = (c, m) => { if (!c) throw new Error('ASSERT: ' + m); };

(async () => {
  // a note with an image, a "pdf" doc with a binary source file, folder + tags
  const note = await S.createNote('My note', 'lined');
  note.pages[0].items.push({ id: 'i1', k: 'i', x: 1, y: 2, w: 3, h: 4, file: 'img-test.jpg' });
  await S.saveDoc(note);
  const imgBytes = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4, 5, 250, 251, 252, 253]);
  fs.writeFileSync(S.docDir(note.id) + 'img-test.jpg', imgBytes);
  const pdfId = S.uid();
  fs.mkdirSync(S.docDir(pdfId), { recursive: true });
  const pdfBytes = Buffer.alloc(200000); for (let i = 0; i < pdfBytes.length; i++) pdfBytes[i] = (i * 31) & 255;
  fs.writeFileSync(S.pdfPathOf(pdfId), pdfBytes);
  await S.saveDoc({ id: pdfId, title: 'My pdf', type: 'pdf', createdAt: 1, updatedAt: 1, pages: [{ id: 'pg', w: 595, h: 842, bg: 'pdf', pdfIndex: 0, items: [] }] });
  const f = await S.createFolder('Work');
  await S.setDocFolder(note.id, f.id);
  await S.setDocTags(note.id, ['math', ' physics ', 'math', '']);

  const zipPath = await B.createBackup();
  assert(fs.existsSync(zipPath) && zipPath.endsWith('.zip'), 'zip written');

  // wipe everything, restore
  fs.rmSync(DOC, { recursive: true, force: true }); fs.mkdirSync(DOC, { recursive: true });
  assert((await S.listDocs()).length === 0, 'wiped');
  const n = await B.restoreBackup(zipPath);
  assert(n === 2, 'two docs restored, got ' + n);
  const docs = await S.listDocs(); const folders = await S.listFolders();
  assert(docs.length === 2 && folders.length === 1 && folders[0].name === 'Work', 'folders restored');
  const rn = docs.find((d) => d.title === 'My note'); const rp = docs.find((d) => d.title === 'My pdf');
  assert(rn && rp, 'titles restored');
  assert(rn.folder === folders[0].id, 'folder mapped to the new id');
  assert(JSON.stringify(rn.tags) === JSON.stringify(['math', 'physics']), 'tags de-duplicated and trimmed: ' + JSON.stringify(rn.tags));
  assert(rn.id !== note.id, 'restored as a new document id');
  const loaded = await S.loadDoc(rn.id); assert(loaded.id === rn.id && loaded.pages[0].items[0].file === 'img-test.jpg', 'doc json rewritten with new id');
  assert(Buffer.compare(fs.readFileSync(S.docDir(rn.id) + 'img-test.jpg'), imgBytes) === 0, 'image bytes identical');
  assert(Buffer.compare(fs.readFileSync(S.pdfPathOf(rp.id)), pdfBytes) === 0, 'pdf bytes identical');

  // restoring the same backup again must add copies, never overwrite
  const n2 = await B.restoreBackup(zipPath); assert(n2 === 2 && (await S.listDocs()).length === 4, 'second restore adds copies');
  // garbage file is rejected
  fs.writeFileSync(CACHE + 'bad.zip', 'not a zip'); let rejected = false;
  try { await B.restoreBackup(CACHE + 'bad.zip'); } catch { rejected = true; }
  assert(rejected, 'invalid backup rejected');
  // folder deletion keeps the docs
  await S.deleteFolder(folders[0].id); assert((await S.listDocs()).every((d) => !d.folder), 'docs survive folder deletion');
  console.log('backup/restore OK');
})().catch((e) => { console.error(e); process.exit(1); });
