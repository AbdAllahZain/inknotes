// Fails when two source files share a module name with different extensions (foo.ts + foo.tsx).
// Metro silently picks one of them; a stale leftover file then breaks the app at runtime.
const fs = require('fs'), path = require('path');
const seen = new Map(); let bad = 0;
(function walk(d) { for (const f of fs.readdirSync(d)) { const p = path.join(d, f);
  if (fs.statSync(p).isDirectory()) { if (!['node_modules', 'android', 'ios', '.git'].includes(f)) walk(p); continue; }
  const m = f.match(/^(.*)\.(ts|tsx|js|jsx)$/); if (!m || /\.d\.ts$/.test(f)) continue;
  const key = path.join(d, m[1]); if (seen.has(key)) { bad++; console.log('DUPLICATE module name:', seen.get(key), 'and', p); } else seen.set(key, p); } })(path.join(__dirname, '../src'));
console.log(bad ? 'duplicate check: ' + bad + ' problem(s)' : 'no duplicate module names');
process.exit(bad ? 1 : 0);
