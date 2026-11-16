// Flow contract: public offline entries and search results retain typed optional label evidence without conflating label and membership versions.
import type { TerminologySnapshotRuntimeNode } from '../../dist/index.js';

declare const runtime: TerminologySnapshotRuntimeNode;
const selector = { claim: 'Condition.code', language: 'es' };
const entries = runtime.entries('synthetic-retention', selector);
const groupedSource: string | undefined = entries[0]?.meta.labelProvenance?.sourceVersion;
const matches = runtime.search('synthetic-retention', { ...selector, text: 'nombre' });
const membershipVersion: string = matches[0]!.versionId;
const labelVersion: string | undefined = matches[0]?.labelProvenance?.sourceVersion;
const designationType: string | undefined = matches[0]?.labelProvenance?.designation.type;
// @ts-expect-error An individual match exposes its own designation, not a catalog map.
matches[0]!.labelProvenance?.designations;
// @ts-expect-error Designation evidence is immutable.
matches[0]!.labelProvenance!.designation.type = 'changed';
void [groupedSource, membershipVersion, labelVersion, designationType];
