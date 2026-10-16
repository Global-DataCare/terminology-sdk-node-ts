# terminology-sdk-node-ts

Node.js adapters for authenticated download, SHA-256 verification, atomic local
activation and offline search of terminology snapshots. BFFs, chatbot, voice
and WhatsApp services can share one process-local index backed by an explicit
cache directory.

The runtime exposes complete grouped entries through `entries(snapshotId,
{ claim, language })` and local autocomplete through `search(snapshotId,
{ claim, language, text })`. It never expands the downloaded `code -> value`
maps into a different wire format.

Contracts come from
[`terminology-data-utils-ts`](https://github.com/Global-DataCare/terminology-data-utils-ts)
and local search from
[`terminology-sdk-core-ts`](https://github.com/Global-DataCare/terminology-sdk-core-ts).
The expected manifest and snapshot producer is
[`terminology-api-node-ts`](https://github.com/Global-DataCare/terminology-api-node-ts).

This is the neutral successor to earlier portal-local terminology adapters.
It contains no terminology datasets and grants no vocabulary licence.
The [public SDK versus managed service boundary](docs/PUBLIC_AND_MANAGED_SERVICE_BOUNDARY.md)
defines which ingestion, translation, licensing and production-maintenance
capabilities remain private to the subscription service.

`TerminologyClient` is the recommended server-only boundary for portal and
assistant BFFs. It searches candidates from text, expands the governed
ValueSet for dropdowns, resolves exact labels and caches GET results by
operation, context and language. The caller supplies its governed sector,
jurisdiction and canonical FHIR SearchParameter (`param`). `claim` remains a
compatible alias for flat-claim integrations.

The lower-level `TerminologyCandidateClient` remains exported for existing
integrations. Product policy and clinical persistence remain in the caller,
and the browser never receives either client or the service token.

See [the Next.js BFF integration guide](docs/NEXTJS_BFF_INTEGRATION.md) for
copyable, commented routes and the research-search guidance.
