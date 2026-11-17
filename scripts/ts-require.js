// Tiny TypeScript loader so tests can require() project .ts files directly.
const ts = require('typescript');
const fs = require('fs');
require.extensions['.ts'] = function (module, filename) {
  const src = fs.readFileSync(filename, 'utf8');
  const out = ts.transpileModule(src, { compilerOptions: { module: 'commonjs', target: 'es2019', esModuleInterop: true }, fileName: filename });
  module._compile(out.outputText, filename);
};
