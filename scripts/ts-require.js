// Tiny TypeScript loader so tests can require() project .ts/.tsx files directly.
const ts = require('typescript');
const fs = require('fs');
function load(module, filename) {
  const src = fs.readFileSync(filename, 'utf8');
  const out = ts.transpileModule(src, {
    compilerOptions: { module: 'commonjs', target: 'es2019', esModuleInterop: true, jsx: ts.JsxEmit.React },
    fileName: filename,
  });
  module._compile(out.outputText, filename);
}
require.extensions['.ts'] = load;
require.extensions['.tsx'] = load;
