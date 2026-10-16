// Flow contract: integrators can copy one browser-to-BFF code search flow for both data entry and explicit Research filters.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const guideUrl = new URL('../docs/NEXTJS_BFF_INTEGRATION.md', import.meta.url);

test('documents a reusable React code picker and the equivalent Research query-builder flow', async () => {
  const guide = await readFile(guideUrl, 'utf8');

  assert.match(guide, /## Reusable React code search component/u);
  assert.match(guide, /export function TerminologyCodeSearch/u);
  assert.match(guide, /\/api\/terminology\/candidates/u);
  assert.match(guide, /## Use the same component in Research/u);
  assert.match(guide, /system: candidate\.system/u);
  assert.match(guide, /code: candidate\.code/u);
  assert.match(guide, /code-display/u);
  assert.match(guide, /code-text/u);
});
