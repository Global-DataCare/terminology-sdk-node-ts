// Flow contract: reuse shared test fixtures and canonical types; do not introduce duplicated literals.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { buildTerminologySnapshotKey } from 'terminology-data-utils-ts';
import { TerminologySnapshotRuntimeNode } from '../dist/index.js';

// Synthetic content is intentional: download integrity and offline lookup are the behaviors under test.
const identity = Object.freeze({
  sector: 'health-care', jurisdiction: 'CA-BC', fhirVersion: 'R4', release: '2026-09',
});
const snapshotId = buildTerminologySnapshotKey(identity);
const snapshot = {
  jsonapi: { version: '1.1' }, schemaVersion: '2', id: snapshotId, generatedAt: '2026-09-28T12:00:00.000Z', identity,
  terminologyVersions: { 'http://hl7.org/fhir/sid/icd-10': '2026' },
  sources: [{ id: 'ICD10', system: 'http://hl7.org/fhir/sid/icd-10', version: '2026', license: 'test', provenance: 'synthetic' }],
  data: [{
    type: 'terminology-value-set', id: 'https://terminology.example/ValueSet/conditions', language: 'es',
    attributes: { J10: 'Gripe estacional' },
    meta: { versionId: '2026-09', system: 'http://hl7.org/fhir/sid/icd-10', sources: ['ICD10'], flatClaims: ['Condition.code'] },
  }],
};
const bytes = Buffer.from(JSON.stringify(snapshot));
const sha256 = createHash('sha256').update(bytes).digest('hex');
const manifest = {
  schemaVersion: '2', generatedAt: '2026-09-28T12:00:01.000Z',
  snapshots: [{ id: snapshotId, identity, sha256, byteLength: bytes.byteLength, downloadUrl: 'https://terminology.example/snapshots/condition-es.json' }],
};

test('downloads, verifies and atomically activates a snapshot for offline search', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'terminology-node-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const requests = [];
  const runtime = new TerminologySnapshotRuntimeNode({
    manifestUrl: 'https://terminology.example/manifest.json', cacheDirectory: directory, serviceToken: 'test-token',
    fetchImplementation: async (url, init) => {
      requests.push({ url: String(url), authorization: new Headers(init?.headers).get('authorization') });
      return String(url).endsWith('manifest.json')
        ? Response.json(manifest)
        : new Response(bytes, { headers: { 'content-type': 'application/json' } });
    },
  });
  assert.equal(await runtime.synchronize(snapshotId), 'updated');
  assert.deepEqual(runtime.entries(snapshotId, { claim: 'Condition.code', language: 'es' })[0].attributes, { J10: 'Gripe estacional' });
  assert.deepEqual(runtime.search(snapshotId, { claim: 'Condition.code', language: 'es', text: 'estacional' }).map(item => item.code), ['J10']);
  assert.equal(requests.every(request => request.authorization === 'Bearer test-token'), true);

  const offline = new TerminologySnapshotRuntimeNode({
    manifestUrl: 'https://terminology.example/manifest.json', cacheDirectory: directory,
    fetchImplementation: async () => { throw new Error('offline'); },
  });
  await offline.load(snapshotId);
  assert.deepEqual(offline.search(snapshotId, { claim: 'Condition.code', language: 'es', text: 'gripe' }).map(item => item.code), ['J10']);
});

test('rejects a corrupt download without replacing the active snapshot', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'terminology-node-corrupt-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const runtime = new TerminologySnapshotRuntimeNode({
    manifestUrl: 'https://terminology.example/manifest.json', cacheDirectory: directory,
    fetchImplementation: async (url) => String(url).endsWith('manifest.json')
      ? Response.json(manifest)
      : new Response('{}'),
  });
  await assert.rejects(runtime.synchronize(snapshotId), /terminology_snapshot_(byte_length|sha256)_mismatch/);
  assert.throws(() => runtime.search(snapshotId, { claim: 'Condition.code', language: 'es', text: 'gripe' }), /terminology_snapshot_not_active/);
});

test('does not forward the service credential to a foreign snapshot origin', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'terminology-node-origin-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const foreign = { ...manifest, snapshots: [{ ...manifest.snapshots[0], downloadUrl: 'https://objects.example/snapshot.json' }] };
  const authorizations = [];
  const runtime = new TerminologySnapshotRuntimeNode({
    manifestUrl: 'https://terminology.example/manifest.json', cacheDirectory: directory, serviceToken: 'private-token',
    fetchImplementation: async (url, init) => {
      authorizations.push([String(url), new Headers(init?.headers).get('authorization')]);
      return String(url).endsWith('manifest.json') ? Response.json(foreign) : new Response(bytes);
    },
  });
  await runtime.synchronize(snapshotId);
  assert.deepEqual(authorizations.map(entry => entry[1]), ['Bearer private-token', null]);
});
