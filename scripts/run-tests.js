// npm test — runs the rules engine suite + AI smoke games.
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const failed = [];
const run = (args) => {
  console.log(`\n=== node ${args.join(' ')}`);
  const r = spawnSync(process.execPath, args, { cwd: path.join(__dirname, '..'), stdio: 'inherit' });
  if (r.status !== 0) failed.push(args.join(' '));
};
run(['scripts/engine-test.js']);
run(['scripts/smoke-ai.js']);
console.log(failed.length ? `\nFAILED: ${failed.join(', ')}` : '\nALL TEST FILES PASSED');
process.exit(failed.length ? 1 : 0);
