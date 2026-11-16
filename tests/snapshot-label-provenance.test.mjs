// Flow contract: authenticated snapshot download verifies exact bytes, atomically persists them, and reopens offline with every label's designation intact; old snapshots and failed-integrity updates retain their original behavior without inventing catalog authority.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import test from 'node:test';
import { buildTerminologySnapshotKey } from 'terminology-data-utils-ts';
import { TerminologySnapshotRuntimeNode } from '../dist/index.js';

function fixture(includeMetadata = true) {
  const identity = { sector: 'health-care', jurisdiction: 'ES', fhirVersion: 'R4', release: 'synthetic-retention' };
  const system = 'https://example.invalid/codes';
  const provenance = { sourceId: 'LABELS', sourceVersion: 'labels-2', policy: 'official-test-selection', designations: { A: { type: 'formal-name', descriptionId: 'description-a', effectiveTime: '20261110' } } };
  const snapshot = { jsonapi: { version: '1.1' }, schemaVersion: '2', id: buildTerminologySnapshotKey(identity), identity,
    generatedAt: '2026-11-16T00:00:00.000Z', terminologyVersions: { [system]: 'membership-1' },
    sources: [{ id: 'MEMBERSHIP', system, version: 'membership-1', license: 'synthetic-only', provenance: 'synthetic-membership' }, { id: 'LABELS', system, version: 'labels-2', license: 'synthetic-only', provenance: 'synthetic-labels' }],
    data: [{ type: 'terminology-system', id: system, language: 'es', attributes: { A: 'nombre de ejemplo' }, meta: {
      versionId: 'membership-1', system, sources: ['MEMBERSHIP', 'LABELS'], flatClaims: ['Condition.code'], ...(includeMetadata ? { labelProvenance: provenance } : {}),
    } }],
  };
  const bytes = Buffer.from(JSON.stringify(snapshot)), sha256 = createHash('sha256').update(bytes).digest('hex');
  const manifest = { schemaVersion: '2', generatedAt: snapshot.generatedAt, snapshots: [{ id: snapshot.id, identity, sha256, byteLength: bytes.length, downloadUrl: 'https://example.invalid/snapshot' }] };
  return { snapshot, bytes, manifest, provenance };
}

async function scratch(t) {
  const parent = await realpath(tmpdir());
  const directory = await mkdtemp(join(parent, 'term-meta-'));
  t.after(async () => {
    const resolved = await realpath(directory);
    assert.equal(dirname(resolved), parent); assert.ok(basename(resolved).startsWith('term-meta-'));
    await rm(resolved, { recursive: true, force: true });
  });
  return directory;
}
const selector = { claim: 'Condition.code', language: 'es' };

test('authenticated import, persistence and offline reload retain exact per-label provenance', async t => {
  const f = fixture(), directory = await scratch(t), requests = [];
  const runtime = new TerminologySnapshotRuntimeNode({ manifestUrl: 'https://example.invalid/manifest', cacheDirectory: directory, serviceToken: 'synthetic-service-token',
    fetchImplementation: async (url, init) => {
      requests.push(new Headers(init?.headers).get('authorization'));
      return String(url).endsWith('/manifest') ? Response.json(f.manifest) : new Response(f.bytes);
    },
  });
  assert.equal(await runtime.synchronize(f.snapshot.id), 'updated');
  assert.deepEqual(requests, ['Bearer synthetic-service-token', 'Bearer synthetic-service-token']);
  assert.deepEqual(runtime.entries(f.snapshot.id, selector)[0].meta.labelProvenance, f.provenance);
  const offline = new TerminologySnapshotRuntimeNode({ manifestUrl: 'https://example.invalid/manifest', cacheDirectory: directory, fetchImplementation: async () => { throw Error('must remain offline'); } });
  await offline.load(f.snapshot.id);
  assert.deepEqual(offline.entries(f.snapshot.id, selector)[0].meta.labelProvenance, f.provenance);
  const match = offline.search(f.snapshot.id, { ...selector, text: 'nombre' })[0];
  assert.equal(match.value, 'nombre de ejemplo'); assert.equal(match.versionId, 'membership-1');
  assert.deepEqual(match.labelProvenance, { sourceId: 'LABELS', sourceVersion: 'labels-2', policy: 'official-test-selection', designation: f.provenance.designations.A });
});

test('metadata-free snapshots retain their old offline entries and match shape', async t => {
  const f = fixture(false), directory = await scratch(t);
  const runtime = new TerminologySnapshotRuntimeNode({ manifestUrl: 'https://example.invalid/manifest', cacheDirectory: directory,
    fetchImplementation: async url => String(url).endsWith('/manifest') ? Response.json(f.manifest) : new Response(f.bytes),
  });
  await runtime.synchronize(f.snapshot.id);
  const offline = new TerminologySnapshotRuntimeNode({ manifestUrl: 'https://example.invalid/manifest', cacheDirectory: directory, fetchImplementation: async () => { throw Error('offline'); } });
  await offline.load(f.snapshot.id);
  assert.equal(Object.hasOwn(offline.entries(f.snapshot.id, selector)[0].meta, 'labelProvenance'), false);
  assert.equal(Object.hasOwn(offline.search(f.snapshot.id, { ...selector, text: 'nombre' })[0], 'labelProvenance'), false);
});

test('a rejected integrity update preserves the prior persisted designation after offline reopen', async t => {
  const f = fixture(), directory = await scratch(t); let changed = false;
  const newer = structuredClone(f.snapshot); newer.generatedAt = '2026-11-16T00:00:01.000Z';
  const expectedBytes = Buffer.from(JSON.stringify(newer));
  const nextManifest = structuredClone(f.manifest); nextManifest.snapshots[0].sha256 = createHash('sha256').update(expectedBytes).digest('hex'); nextManifest.snapshots[0].byteLength = expectedBytes.length;
  const runtime = new TerminologySnapshotRuntimeNode({ manifestUrl: 'https://example.invalid/manifest', cacheDirectory: directory,
    fetchImplementation: async url => String(url).endsWith('/manifest') ? Response.json(changed ? nextManifest : f.manifest) : new Response(f.bytes),
  });
  await runtime.synchronize(f.snapshot.id); changed = true;
  await assert.rejects(runtime.synchronize(f.snapshot.id), /terminology_snapshot_sha256_mismatch/);
  const offline = new TerminologySnapshotRuntimeNode({ manifestUrl: 'https://example.invalid/manifest', cacheDirectory: directory, fetchImplementation: async () => { throw Error('offline'); } });
  await offline.load(f.snapshot.id);
  assert.deepEqual(offline.entries(f.snapshot.id, selector)[0].meta.labelProvenance, f.provenance);
});
