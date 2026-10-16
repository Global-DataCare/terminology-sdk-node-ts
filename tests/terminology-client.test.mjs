// Flow contract: every BFF uses one neutral terminology client to search coding candidates, resolve exact labels, and build localized ValueSet dropdowns without exposing source policy or FHIR-version plumbing.
import assert from 'node:assert/strict';
import test from 'node:test';
import { MemoryTerminologyCache, TerminologyClient } from '../dist/terminology-client.js';

test('searches one or more coding systems from text and caches each language independently', async () => {
  const requests = [];
  const client = new TerminologyClient({
    baseUrl: 'https://terminology.example',
    serviceToken: 'private-service-token',
    cache: new MemoryTerminologyCache(),
    fetchImplementation: async (url) => {
      const parsed = new URL(url);
      requests.push(parsed);
      const system = parsed.searchParams.get('system');
      const language = parsed.searchParams.get('language');
      return Response.json({ data: [{
        id: system,
        attributes: { '123': language === 'es' ? 'Dolor' : 'Pain' },
        meta: {
          sources: ['internal-policy-id'], versionId: '2026',
          labels: { '123': { text: language === 'es' ? 'Dolor' : 'Pain', display: 'Pain', textLanguage: language } },
        },
      }] });
    },
  });
  const input = {
    text: 'pain', language: 'es', sector: 'health-care', jurisdiction: 'ES',
    param: 'Condition.code', systems: ['http://snomed.info/sct', 'http://hl7.org/fhir/sid/icd-10'],
  };

  const first = await client.searchCodeCandidatesFromText(input);
  const second = await client.searchCodeCandidatesFromText(input);
  await client.searchCodeCandidatesFromText({ ...input, language: 'en' });

  assert.equal(requests.length, 4);
  assert(requests.every((request) => request.searchParams.get('claim') === 'Condition.code'));
  assert(requests.every((request) => request.searchParams.get('fhirVersion') === 'R4'));
  assert.deepEqual(first, second);
  assert.deepEqual(first, [
    { source: 'internal-policy-id', system: 'http://snomed.info/sct', code: '123', text: 'Dolor', display: 'Pain', language: 'es', terminologyVersion: '2026' },
    { source: 'internal-policy-id', system: 'http://hl7.org/fhir/sid/icd-10', code: '123', text: 'Dolor', display: 'Pain', language: 'es', terminologyVersion: '2026' },
  ]);
});

test('accepts claim as a compatible alias for param and keeps source optional', async () => {
  let request;
  const client = new TerminologyClient({
    baseUrl: 'https://terminology.example', serviceToken: 'secret',
    fetchImplementation: async (url) => {
      request = new URL(url);
      return Response.json({ data: [] });
    },
  });

  await client.searchCodeCandidatesFromText({
    text: 'rash', claim: 'Condition.code', language: 'en', sector: 'health-care',
    sources: ['SNOMED-GPS'],
  });

  assert.equal(request.searchParams.get('claim'), 'Condition.code');
  assert.equal(request.searchParams.has('jurisdiction'), false);
  assert.deepEqual(request.searchParams.getAll('source'), ['SNOMED-GPS']);
});

test('returns every localized ValueSet option as system, code, text and English display', async () => {
  const requests = [];
  const client = new TerminologyClient({
    baseUrl: 'https://terminology.example', serviceToken: 'secret',
    fetchImplementation: async (url) => {
      const parsed = new URL(url);
      requests.push(parsed);
      const offset = Number(parsed.searchParams.get('offset'));
      return Response.json(offset === 0 ? {
        data: [
          { attributes: { system: 'http://snomed.info/sct', code: '39579001', display: 'Anaphylaxis', localizedDisplay: 'Anafilaxia', resolvedLanguage: 'es', fallbackUsed: false } },
          { attributes: { system: 'http://example.org/local', code: 'A1', display: 'Local reaction', localizedDisplay: 'Reacción local', resolvedLanguage: 'es', fallbackUsed: false } },
        ],
        meta: { total: 3, offset: 0, terminologyVersions: { 'http://snomed.info/sct': '20240701' } },
      } : {
        data: [{ attributes: { system: 'http://snomed.info/sct', code: '271807003', display: 'Skin rash', localizedDisplay: 'Erupción cutánea', resolvedLanguage: 'es', fallbackUsed: false } }],
        meta: { total: 3, offset: 2 },
      });
    },
  });

  const options = await client.getCodeOptionsForParameter({
    param: 'AllergyIntolerance.manifestation', language: 'es', sector: 'health-care', jurisdiction: 'ES', pageSize: 2,
  });

  assert.equal(requests.length, 2);
  assert(requests.every((request) => request.pathname === '/v1/terminology/value-set-options'));
  assert.deepEqual(options, [
    { system: 'http://snomed.info/sct', code: '39579001', text: 'Anafilaxia', display: 'Anaphylaxis', language: 'es', fallbackUsed: false, terminologyVersion: '20240701' },
    { system: 'http://example.org/local', code: 'A1', text: 'Reacción local', display: 'Local reaction', language: 'es', fallbackUsed: false },
    { system: 'http://snomed.info/sct', code: '271807003', text: 'Erupción cutánea', display: 'Skin rash', language: 'es', fallbackUsed: false, terminologyVersion: '20240701' },
  ]);
});

test('resolves an exact system and code with localized text and English display', async () => {
  const client = new TerminologyClient({
    baseUrl: 'https://terminology.example', serviceToken: 'secret',
    fetchImplementation: async () => Response.json({ data: {
      attributes: {
        system: 'http://www.whocc.no/atcvet', code: 'QI07AA90',
        text: 'Vacuna antirrábica', display: 'Rabies vaccine', textLanguage: 'es',
        displayLanguage: 'en', terminologyVersion: '2026',
      },
    } }),
  });

  assert.deepEqual(await client.resolveCodeLabels({
    system: 'http://www.whocc.no/atcvet', code: 'QI07AA90', param: 'Immunization.vaccine-code',
    language: 'es', sector: 'animal-care', jurisdiction: 'ES',
  }), {
    system: 'http://www.whocc.no/atcvet', code: 'QI07AA90', text: 'Vacuna antirrábica',
    display: 'Rabies vaccine', language: 'es', terminologyVersion: '2026',
  });
});

test('supports a local terminology service without authentication while never sending an empty bearer', async () => {
  let authorization = 'not-called';
  const client = new TerminologyClient({
    baseUrl: 'http://127.0.0.1:3501',
    fetchImplementation: async (_url, init) => {
      authorization = new Headers(init?.headers).get('authorization');
      return Response.json({ data: null });
    },
  });

  await client.resolveCodeLabels({
    system: 'http://loinc.org', code: '8310-5', param: 'Observation.code',
    language: 'en', sector: 'health-care', jurisdiction: 'ES',
  });
  assert.equal(authorization, null);
});

test('obtains a fresh backend access token for each uncached service request', async () => {
  const authorizations = [];
  let tokenCalls = 0;
  const client = new TerminologyClient({
    baseUrl: 'https://terminology.example',
    accessTokenProvider: async () => `short-lived-token-${++tokenCalls}`,
    fetchImplementation: async (_url, init) => {
      authorizations.push(new Headers(init?.headers).get('authorization'));
      return Response.json({ data: { attributes: {
        system: 'http://loinc.org', code: new URL(_url).searchParams.get('code'),
        text: 'Label', display: 'Label', textLanguage: 'en',
      } } });
    },
  });

  const context = {
    system: 'http://loinc.org', param: 'Observation.code', language: 'en',
    sector: 'health-care', jurisdiction: 'ES',
  };
  await client.resolveCodeLabels({ ...context, code: '8310-5' });
  await client.resolveCodeLabels({ ...context, code: '8310-5' });
  await client.resolveCodeLabels({ ...context, code: '8480-6' });

  assert.deepEqual(authorizations, [
    'Bearer short-lived-token-1',
    'Bearer short-lived-token-2',
  ]);
  assert.equal(tokenCalls, 2);
});
