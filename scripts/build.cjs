'use strict';

const { spawnSync } = require('node:child_process');

function run(command, args) {
  const result = spawnSync(command, args, { stdio: 'inherit' });
  if (result.error) {
    console.error(result.error);
    process.exit(result.status || 1);
  }
  if (result.status !== 0) {
    process.exit(result.status);
  }
}

// 1) Type-check/compile with tsc in build mode (noEmit=true in tsconfig means just typecheck)
run(process.execPath, ['./node_modules/typescript/bin/tsc', '-b']);

// 2) Build with Vite using its API to avoid pkg/require ESM issues
(async () => {
  const vite = await import('vite');
  await vite.build();
})().catch((err) => {
  console.error(err);
  process.exit(1);
});


