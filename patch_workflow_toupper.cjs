const fs = require('fs');
let code = fs.readFileSync('server/utils/tools/workflow.ts', 'utf8');

code = code.replace(
  /triggerProvider\.toUpperCase\(\)/g,
  "(triggerProvider || 'custom').toUpperCase()"
);

code = code.replace(
  /\(step\.provider === 'slack'/g,
  "(step.provider && step.provider === 'slack'"
);

fs.writeFileSync('server/utils/tools/workflow.ts', code);
console.log('patched toUpperCase issue');
