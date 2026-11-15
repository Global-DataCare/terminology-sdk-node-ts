// Flow contract: a real TypeScript consumer resolves the public candidate-client subpath against the declared SOS candidate contract, with negative type evidence rather than runtime casts.
import assert from 'node:assert/strict';
import test from 'node:test';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

test('the public candidate client compiles against its canonical SOS candidate type',()=>{
  const root=fileURLToPath(new URL('../',import.meta.url));
  const result=spawnSync(process.execPath,['node_modules/typescript/bin/tsc','--strict','--noEmit','--module','NodeNext','--moduleResolution','NodeNext','--target','ES2022','tests/fixtures/clinical-candidate-consumer.ts'],{cwd:root,encoding:'utf8'});
  assert.equal(result.status,0,`${result.stdout}\n${result.stderr}`);
});
