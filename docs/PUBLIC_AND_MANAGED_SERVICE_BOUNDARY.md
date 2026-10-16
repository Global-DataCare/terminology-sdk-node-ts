# Public SDK and managed terminology service boundary

This package is the open-source integration boundary. It contains client
contracts, bounded caches, snapshot verification and synthetic tests. It does
not contain licensed terminology datasets or the production process used to
build and maintain them.

The managed terminology service is a separately operated subscription service.
Its private implementation and runbooks include:

- source acquisition, credentials, download locations and licence evidence;
- database/index creation, upgrades, backups and disaster recovery;
- SNOMED CT edition installation and jurisdiction entitlement policy;
- intersection of SNOMED GPS concepts with official national language
  editions, including release/refset selection;
- SNOMED Veterinary Extension availability and permitted-country policy;
- LOINC release and linguistic-variant acquisition, normalization and update;
- WHO ATC and ATCvet acquisition, normalization and release maintenance;
- production catalogs, reviewed mappings, snapshots and translation assets;
- monitoring, rate limits, scaling, security response and support procedures.

Open-source tests use only small synthetic fixtures or content that is clearly
redistributable for that purpose. Passing those tests demonstrates protocol
compatibility; it does not reproduce the maintained production service,
licensed coverage, translations, availability or support.

Portals subscribe to the service and integrate through their authenticated BFF
with `TerminologyClient`. They never receive upstream source credentials,
licensed bulk files, service-maintenance endpoints or entitlement tables.
