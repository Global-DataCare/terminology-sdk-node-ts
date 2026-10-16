# Next.js BFF terminology integration

This guide is product-neutral. A Vet, human-health, emergency or third-party
portal can use the same server-side client. Keep the service token in the BFF;
never import this package from a Client Component.

## The four concepts

- `param` is the canonical resource-qualified FHIR SearchParameter used by the
  screen, such as `Condition.code`. `claim` is accepted as a compatible alias.
- `system` is the canonical `Coding.system` URI. Together, `system|code`
  identifies the clinical concept.
- `source` is optional provider, edition or policy provenance. It is not a
  second coding system. Most portals should omit it and let server policy pick
  the allowed sources. Send it only when the integration has a governed reason.
- `language` controls the returned local `text`. `display` remains the English
  label. Do not put a translated label in `Resource.language`; that field is a
  BCP 47 language code.

FHIR version is deliberately absent from the high-level API. The current
service wire contract still receives its compatible default internally, so a
portal does not need to understand or repeat it.

## Install and configure once

```bash
npm install terminology-sdk-node-ts
```

Create a server-only module. A module singleton reuses the cache across route
calls in the same BFF process.

```ts
// src/server/terminology.ts
import 'server-only';
import {
  MemoryTerminologyCache,
  TerminologyClient,
} from 'terminology-sdk-node-ts/terminology-client';

const baseUrl = process.env.TERMINOLOGY_BASE_URL;
const serviceToken = process.env.TERMINOLOGY_SERVICE_TOKEN;
if (!baseUrl || !serviceToken) throw new Error('terminology_configuration_required');

export const terminology = new TerminologyClient({
  baseUrl,
  serviceToken,
  cache: new MemoryTerminologyCache({ maxEntries: 2_000 }),
  candidateTtlMs: 5 * 60_000,       // text search changes frequently
  stableTtlMs: 24 * 60 * 60_000,    // ValueSets and exact labels are stable
});
```

`MemoryTerminologyCache` is bounded and process-local. In a multi-replica BFF,
implement the small asynchronous `TerminologyCache` interface with Redis or the
platform cache. Cache keys already separate English, Spanish, French and every
other requested language. English is the baseline; request and cache another
supported language lazily when a user selects it. POST/review writes must never
be cached.

## Search candidates when the user presses Search

```ts
// app/api/terminology/candidates/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { terminology } from '@/server/terminology';

export async function GET(request: NextRequest) {
  // Replace this with the portal's trusted BFF session/capability check.
  await requireAuthorizedProfessional(request);

  const query = request.nextUrl.searchParams;
  const candidates = await terminology.searchCodeCandidatesFromText({
    text: query.get('text') ?? '',
    language: query.get('language') ?? 'en',
    sector: authorizedSectorFromSession(),
    jurisdiction: authorizedJurisdictionFromSession(),
    param: query.get('param') ?? '',
    // Optional: one or more Coding.system URIs. Omit to search every system
    // allowed by terminology policy for this parameter and jurisdiction.
    systems: query.getAll('system'),
    limit: 20,
  });

  return NextResponse.json({ candidates });
}
```

The BFF, not the browser, derives `sector` and jurisdiction from trusted tenant,
wallet or session context. A changed URL or browser-selected role must not grant
access to another sector.

## Populate a dropdown from the governed ValueSet

```ts
// app/api/terminology/options/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { terminology } from '@/server/terminology';

export async function GET(request: NextRequest) {
  await requireAuthorizedProfessional(request);
  const query = request.nextUrl.searchParams;

  const options = await terminology.getCodeOptionsForParameter({
    param: query.get('param') ?? '',
    language: query.get('language') ?? 'en',
    sector: authorizedSectorFromSession(),
    jurisdiction: authorizedJurisdictionFromSession(),
  });

  // Each item contains system, code, localized text and English display.
  // Use `${system}|${code}` as the option value; show text to the user.
  return NextResponse.json({ options });
}
```

This method follows every server page and supports ValueSets containing more
than one coding system. Do not collapse the result to a `code -> display` map,
because codes are only unique inside their system.

## Resolve labels for an existing code

```ts
const labels = await terminology.resolveCodeLabels({
  system: coding.system,
  code: coding.code,
  param: 'Condition.code',
  language: resource.language ?? userSupportedLanguage,
  sector: authorizedSector,
  jurisdiction: authorizedJurisdiction,
});

if (labels) {
  // labels.text: requested/local label
  // labels.display: canonical English label
}
```

Persist the selected `system` and `code`. Localized `text` is presentation and
English `display` is a stable cross-language research label; neither replaces
the coded identity.

## Research indexing and searching

For structured research, index `system|code` and use it for precise cohort
filters. Also index `code-display` in English for cross-language discovery and,
when the source resource language is not English, `code-text` in that resource
language. This permits text discovery without pretending that labels are
identifiers.

Do not expand an arbitrary research phrase into every possible code and then
silently treat the union as an exact clinical filter. Candidate expansion is
appropriate for an explicit, reviewable query-builder step. A free-text
research box should search the indexed English display plus the applicable
localized text; the UI can then offer resolved codes as refinements.

Recommended persistence and index fields:

```text
code-system   = Coding.system
code          = Coding.code
code-display  = canonical English label
code-text     = label in Resource.language
code-language = Resource.language
```

If terminology is temporarily unavailable, keep the original code and defer
label enrichment. Do not copy an untrusted clinical source label into a
pseudonymous research projection as if it were terminology-verified.

## Compatibility

Existing code using `TerminologyCandidateClient.search({ claim, fhirVersion,
sources, ... })` continues to work. New BFF code should use
`TerminologyClient`; it accepts `claim` as an alias for `param` and allows
optional `sources`, while keeping the simpler path free of service-specific
details.
