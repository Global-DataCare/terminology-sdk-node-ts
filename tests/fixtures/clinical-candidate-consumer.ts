// Flow contract: the public terminology client returns the canonical independent SOS candidate type without changing grouped wire data or clinical policy.
import type {ClinicalTerminologyCandidate} from 'sos-data-utils-ts/clinical-terminology';
import type {TerminologyCandidateClient,TerminologyCandidateSearch} from 'terminology-sdk-node-ts/candidate-client';

declare const client:TerminologyCandidateClient;
declare const input:TerminologyCandidateSearch;
const result:Promise<readonly ClinicalTerminologyCandidate[]>=client.search(input);
void result;

declare const candidate:ClinicalTerminologyCandidate;
const canonicalSystem:string=candidate.system;
const canonicalCode:string=candidate.code;
const canonicalDisplay:string=candidate.display;
const localizedText:string|undefined=candidate.text;
void [canonicalSystem,canonicalCode,canonicalDisplay,localizedText];
// @ts-expect-error Canonical terminology codes remain strings at the public boundary.
const invalidCode:number=candidate.code;
void invalidCode;
