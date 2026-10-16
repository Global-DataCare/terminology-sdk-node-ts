// Flow contract: a server-side channel searches the governed terminology API with its private credential and receives canonical candidates with local text distinct from English display.
import assert from 'node:assert/strict';
import test from 'node:test';
import { TerminologyCandidateClient } from '../dist/candidate-client.js';

test('maps grouped JSON:API resources to canonical clinical candidates', async () => {
  const requests = [];
  const client = new TerminologyCandidateClient({
    baseUrl: 'https://terminology.example',
    serviceToken: 'private-service-token',
    fetchImplementation: async (url, init) => {
      requests.push({ url: String(url), init });
      return Response.json({ data: [{
        id: 'http://hl7.org/fhir/sid/icd-10',
        attributes: { H160: 'Úlcera corneal' },
        meta: {
          sources: ['ICD10'], versionId: '2026',
          labels: { H160: { text: 'Úlcera corneal', display: 'Corneal ulcer', textLanguage: 'es' } },
        },
      }] });
    },
  });

  const candidates = await client.search({
    text: 'úlcera corneal', language: 'es', fhirVersion: 'R4', sector: 'health-care',
    jurisdiction: 'ES', claim: 'Condition.code', limit: 20,
  });

  assert.match(requests[0].url, /claim=Condition.code/);
  assert.match(requests[0].url, /sector=health-care/);
  assert.equal(requests[0].init.headers.authorization, 'Bearer private-service-token');
  assert.deepEqual(candidates, [{
    source: 'ICD10', system: 'http://hl7.org/fhir/sid/icd-10', code: 'H160',
    text: 'Úlcera corneal', display: 'Corneal ulcer', language: 'es', terminologyVersion: '2026',
  }]);
});

test('rejects unsafe or unbounded requests before contacting the service', async () => {
  let calls = 0;
  const client = new TerminologyCandidateClient({
    baseUrl: 'https://terminology.example', serviceToken: 'secret',
    fetchImplementation: async () => { calls += 1; return Response.json({ data: [] }); },
  });
  await assert.rejects(client.search({
    text: 'x', language: 'es', fhirVersion: 'R4', sector: 'health-care',
    jurisdiction: 'ES', claim: 'Condition.code', limit: 20,
  }), /terminology_search_invalid/);
  assert.equal(calls, 0);
});
