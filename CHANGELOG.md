# Changelog

## Unreleased

- Accept canonical `org.schema.<Type>.<property>` claims in the high-level BFF
  client so non-FHIR qualification editors can search and resolve labels while
  preserving the same terminology identity.
- Preserve a system's pinned version from the grouped JSON:API document metadata
  when the individual terminology resource omits a duplicate version field.

## 0.3.1 - 2026-10-15

- Add an asynchronous `accessTokenProvider` for short-lived backend OIDC
  access tokens while retaining `serviceToken` compatibility.
- Document the separation between end-user authentication, backend identity,
  issuer JWKS and the terminology client.

## 0.3.0 - 2026-10-15

- Add a neutral `TerminologyClient` for text candidates, complete governed
  ValueSet dropdown options and exact `system|code` label resolution.
- Add bounded process-local caching with independent entries per requested
  language and an adapter interface for shared BFF caches.
- Accept `param` as the high-level FHIR SearchParameter name while preserving
  `claim` and `source` compatibility.
- Document copyable Next.js BFF handlers and research indexing guidance.

## 0.2.1 - 2026-09-29

- Add a server-only candidate client that validates bounded search input,
  authenticates to the terminology service and preserves code system, code,
  source, terminology version, local text and English display separately.

## 0.2.0

- Consume the corrected grouped terminology snapshot contract.
- Expose complete cached entries by canonical flat claim and language.
- Search only inside entries applicable to the requested editor field.

## 0.1.0

- Add authenticated manifest and snapshot download.
- Verify byte length and SHA-256 before activation.
- Add atomic filesystem cache and offline restart support.
- Never forward service credentials to a foreign download origin.
