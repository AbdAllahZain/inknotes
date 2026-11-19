// Renders the real screens with react-test-renderer. Native libraries are replaced by light stubs,
// but ALL of this project's own modules are the real ones, so "Element type is invalid" errors show up here.
require('./ts-require');
const fs = require('fs'), path = require('path'), os = require('os'), Module = require('module');
const React = require('react');
const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'ink-smoke-'));
const DOC = ROOT + '/documents/', CACHE = ROOT + '/cache/';
fs.mkdirSync(DOC, { recursive: true }); fs.mkdirSync(CACHE, { recursive: true });

const h = React.createElement;
const comp = (name) => { const C = (p) => h('Mock' + name, null, p.children); C.displayName = name; return C; };
const deep = (label) => new Proxy(function () {}, {
  get: (_t, k) => (k === Symbol.toPrimitive ? () => 0 : k === 'then' ? undefined : deep(label + '.' + String(k))),
  apply: () => deep(label + '()'), construct: () => deep(label + 'new'),
});
const compProxy = (extra = {}) => new Proxy({ ...extra }, {
  get: (t, k) => { if (k in t) return t[k]; if (k === '__esModule') return true; if (typeof k !== 'string') return undefined;
    return /^[A-Z]/.test(k) ? (t[k] = comp(k)) : (t[k] = deep(k)); },
});
const sv = (v) => ({ value: v, modify(fn) { this.value = fn(this.value) || this.value; } });
const chain = () => { const o = new Proxy({}, { get: (_t, k) => (k === 'then' ? undefined : (..._a) => o) }); return o; };

const RN = compProxy({
  StyleSheet: { create: (s) => s, absoluteFill: {}, absoluteFillObject: {}, hairlineWidth: 1, flatten: (s) => s },
  Alert: { alert: (...a) => { console.log('[Alert]', a[0], a[1] && a[1].toString().slice(0, 120)); } },
  AppState: { addEventListener: () => ({ remove() {} }) },
  NativeModules: { I18nManager: { localeIdentifier: 'ar_EG' } },
  Dimensions: { get: () => ({ width: 1280, height: 800 }) }, PixelRatio: { get: () => 2 },
  useWindowDimensions: () => ({ width: 1280, height: 800 }), useColorScheme: () => 'light',
  Platform: { OS: 'android' }, I18nManager: { isRTL: false },
  PanResponder: { create: () => ({ panHandlers: {} }) },
  FlatList: (p) => h('MockFlatList', null, (p.data || []).map((it, i) => p.renderItem({ item: it, index: i })), (!p.data || !p.data.length) ? p.ListEmptyComponent : null),
  Modal: (p) => (p.visible ? h('MockModal', null, p.children) : null),
});
const gh = compProxy({
  Gesture: chain() , GestureDetector: (p) => h('MockGD', null, p.children), GestureHandlerRootView: (p) => h('MockRoot', null, p.children),
});
const reanimated = compProxy({
  useSharedValue: (v) => sv(v), useDerivedValue: (fn) => { let v; try { v = fn(); } catch { v = undefined; } return { value: v }; },
  useAnimatedReaction: () => {}, useFrameCallback: () => {}, runOnJS: (f) => f, withTiming: (v) => v, withDecay: (v) => v, cancelAnimation: () => {},
});
const nav = compProxy({
  NavigationContainer: (p) => h('MockNav', null, p.children), DefaultTheme: { colors: {} }, DarkTheme: { colors: {} },
  createNativeStackNavigator: () => ({
    Screen: () => null,
    Navigator: (p) => { const kids = React.Children.toArray(p.children); const first = kids[0];
      return h(first.props.component, { navigation: { navigate: () => {}, goBack: () => {}, addListener: () => () => {} }, route: { params: { docId: global.__DOC_ID } } }); },
  }),
});
const FS = {
  documentDirectory: DOC, cacheDirectory: CACHE, EncodingType: { Base64: 'base64', UTF8: 'utf8' },
  getInfoAsync: async (p) => ({ exists: fs.existsSync(p) }), makeDirectoryAsync: async (p) => fs.mkdirSync(p, { recursive: true }),
  readAsStringAsync: async (p, o) => fs.readFileSync(p).toString(o && o.encoding === 'base64' ? 'base64' : 'utf8'),
  writeAsStringAsync: async (p, s, o) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, Buffer.from(s, o && o.encoding === 'base64' ? 'base64' : 'utf8')); },
  deleteAsync: async (p) => fs.rmSync(p, { recursive: true, force: true }), copyAsync: async ({ from, to }) => fs.copyFileSync(from, to),
  readDirectoryAsync: async (p) => fs.readdirSync(p),
};
const skia = compProxy({
  Skia: deep('Skia'), createPicture: () => ({}), useImage: () => null,
  BlendMode: deep('BlendMode'), PaintStyle: deep('PaintStyle'), ImageFormat: deep('ImageFormat'), TextAlign: deep('TextAlign'), TextDirection: deep('TextDirection'),
});
const stubs = {
  'react-native': RN, 'react-native-gesture-handler': gh, 'react-native-reanimated': reanimated, '@shopify/react-native-skia': skia,
  '@react-navigation/native': nav, '@react-navigation/native-stack': nav,
  'react-native-safe-area-context': compProxy({ SafeAreaProvider: (p) => h('MockSAP', null, p.children), SafeAreaView: (p) => h('MockSAV', null, p.children) }),
  'expo-status-bar': compProxy(), 'expo-file-system': FS, 'expo-sharing': compProxy(), 'expo-document-picker': compProxy(),
  'expo-local-authentication': compProxy({ SecurityLevel: { NONE: 0 } }),
  './pdfNative': { getPdfPageSizes: async () => [], renderPdfPage: async () => ({}) },
};
const orig = Module._load;
Module._load = function (request) { return stubs[request] ? stubs[request] : orig.apply(this, arguments); };

const TR = require('react-test-renderer');
const S = require('../src/services/storage.ts');
const { act } = TR;
const flush = () => new Promise((r) => setTimeout(r, 30));

async function render(label, element) {
  let tree;
  try {
    await act(async () => { tree = TR.create(element); await flush(); await flush(); });
    const json = JSON.stringify(tree.toJSON());
    console.log('OK   ' + label + ' (' + json.length + ' chars of output)');
    return tree;
  } catch (e) { console.log('FAIL ' + label + ' -> ' + String(e.message).split('\n')[0]); process.exitCode = 1; }
}

(async () => {
  const note = await S.createNote('Smoke note', 'lined'); global.__DOC_ID = note.id;
  const App = require('../src/App.tsx').default;
  const { HomeScreen } = require('../src/screens/HomeScreen.tsx');
  const { EditorScreen } = require('../src/screens/EditorScreen.tsx');
  const { SettingsProvider } = require('../src/settings.tsx');
  const { ThemeProvider } = require('../src/appTheme.tsx');
  const navProps = { navigation: { navigate() {}, goBack() {}, addListener: () => () => {} }, route: { params: { docId: note.id } } };
  const wrap = (el) => h(SettingsProvider, null, h(ThemeProvider, null, el));
  await render('App (full tree)', h(App));
  await render('HomeScreen', wrap(h(HomeScreen, navProps)));
  await render('EditorScreen', wrap(h(EditorScreen, navProps)));
})();

// ---- static check: every JSX tag imported from one of OUR modules must exist at runtime
setTimeout(() => {
  const ts = require('typescript');
  const walk = (d, out = []) => { for (const f of fs.readdirSync(d)) { const p = path.join(d, f); fs.statSync(p).isDirectory() ? walk(p, out) : /\.tsx$/.test(f) && out.push(p); } return out; };
  let bad = 0, checked = 0;
  for (const f of walk(path.join(__dirname, '../src'))) {
    const sf = ts.createSourceFile(f, fs.readFileSync(f, 'utf8'), ts.ScriptTarget.ES2020, true, ts.ScriptKind.TSX);
    const imp = {};
    sf.forEachChild((n) => { if (ts.isImportDeclaration(n) && n.importClause && n.moduleSpecifier.text.startsWith('.')) {
      const m = path.resolve(path.dirname(f), n.moduleSpecifier.text);
      const nb = n.importClause.namedBindings; if (nb && ts.isNamedImports(nb)) nb.elements.forEach((e) => (imp[e.name.text] = [m, (e.propertyName || e.name).text])); } });
    (function visit(n) {
      if (ts.isJsxOpeningElement(n) || ts.isJsxSelfClosingElement(n)) {
        const tag = n.tagName.getText(); const root = tag.split('.')[0];
        if (imp[root]) { checked++; let mod; try { mod = require(imp[root][0]); } catch (e) { mod = null; }
          let v = mod && mod[imp[root][1]]; for (const part of tag.split('.').slice(1)) v = v && v[part];
          if (v === undefined || v === null) { bad++; console.log('UNDEFINED JSX tag <' + tag + '> in ' + path.relative(path.join(__dirname, '..'), f)); } }
      }
      n.forEachChild(visit);
    })(sf);
  }
  console.log(bad ? 'static JSX check: ' + bad + ' problem(s)' : 'static JSX check OK (' + checked + ' tags from project modules)');
}, 600);
