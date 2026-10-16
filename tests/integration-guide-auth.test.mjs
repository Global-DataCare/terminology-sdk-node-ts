// Flow contract: a BFF integrator receives complete current authentication instructions without exposing or minting terminology credentials in the portal.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const guideUrl = new URL('../docs/NEXTJS_BFF_INTEGRATION.md', import.meta.url);

test('documents the current BFF bearer contract and the separate end-user session', async () => {
  const guide = await readFile(guideUrl, 'utf8');

  assert.match(guide, /TERMINOLOGY_BASE_URL/);
  assert.match(guide, /TERMINOLOGY_SERVICE_TOKEN/);
  assert.match(guide, /accessTokenProvider/);
  assert.match(guide, /Authorization: Bearer/);
  assert.match(guide, /not the end-user ID token/i);
  assert.match(guide, /does not\s+mint or sign/i);
  assert.match(guide, /secret manager/i);
  assert.match(guide, /static compatibility\s+credential/i);
});
