// Finds worklet closures that capture a const/let declared AFTER the worklet is created
// (this crashes at runtime: "Cannot access ... before initialization" / undefined callbacks).
const parser = require('@babel/parser');
const traverse = require('@babel/traverse').default;
const fs = require('fs');
const files = process.argv.slice(2);
let problems = 0;
for (const f of files) {
  const ast = parser.parse(fs.readFileSync(f, 'utf8'), { sourceType: 'module', plugins: ['typescript', 'jsx'] });
  const HOOKS = new Set(['useAnimatedReaction', 'useDerivedValue', 'useAnimatedStyle', 'useAnimatedProps', 'useFrameCallback']);
  const GESTURE_CB = new Set(['onBegin', 'onStart', 'onUpdate', 'onChange', 'onEnd', 'onFinalize', 'onTouchesDown', 'onTouchesMove', 'onTouchesUp']);
  function isWorklet(path) {
    const body = path.node.body;
    if (body && body.directives && body.directives.some((d) => d.value.value === 'worklet')) return true;
    const parent = path.parentPath;
    if (parent.isCallExpression()) {
      const c = parent.node.callee;
      if (c.type === 'Identifier' && HOOKS.has(c.name)) return true;
      if (c.type === 'MemberExpression' && c.property.type === 'Identifier' && GESTURE_CB.has(c.property.name)) return true;
    }
    return false;
  }
  traverse(ast, {
    Function(path) {
      if (!isWorklet(path)) return;
      const start = path.node.start;
      path.traverse({
        ReferencedIdentifier(ip) {
          const b = ip.scope.getBinding(ip.node.name);
          if (!b) return;
          if (path.scope.hasOwnBinding(ip.node.name)) return;
          // declared inside the worklet itself?
          if (b.path.node.start >= path.node.start && b.path.node.end <= path.node.end) return;
          if ((b.kind === 'const' || b.kind === 'let') && b.path.node.start > start) {
            problems++;
            console.log(`${f}:${ip.node.loc.start.line}  "${ip.node.name}" is used by a worklet created at line ${path.node.loc.start.line} but declared later (line ${b.path.node.loc.start.line})`);
          }
        },
      });
    },
  });
}
console.log(problems ? `FOUND ${problems} problem(s)` : 'worklet order OK');
process.exit(problems ? 1 : 0);
