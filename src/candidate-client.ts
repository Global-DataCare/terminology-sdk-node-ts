import type { ClinicalTerminologyCandidate } from 'sos-data-utils-ts/clinical-terminology';

export type TerminologyAccessTokenProvider = () => string | undefined | Promise<string | undefined>;

export type TerminologyCandidateSearch = Readonly<{
  text: string;
  language: string;
  fhirVersion: string;
  sector: string;
  jurisdiction?: string;
  claim: string;
  limit?: number;
  ncbiTaxonomyId?: string;
  specialty?: string;
  system?: string;
  sources?: readonly string[];
}>;

type CandidateResource = Readonly<{
  id?: unknown;
  attributes?: Readonly<Record<string, unknown>>;
  meta?: Readonly<{
    sources?: unknown;
    versionId?: unknown;
    terminologyVersion?: unknown;
    labels?: Readonly<Record<string, Readonly<{
      text?: unknown;
      display?: unknown;
      textLanguage?: unknown;
    }>>>;
  }>;
}>;

/** Server-only client for the governed candidate endpoint; caller policy stays outside the SDK. */
export class TerminologyCandidateClient {
  readonly #baseUrl: URL;
  readonly #serviceToken: string | undefined;
  readonly #accessTokenProvider: TerminologyAccessTokenProvider | undefined;
  readonly #fetch: typeof fetch;

  public constructor(options: Readonly<{
    baseUrl: string;
    serviceToken?: string;
    accessTokenProvider?: TerminologyAccessTokenProvider;
    fetchImplementation?: typeof fetch;
  }>) {
    if (!URL.canParse(options.baseUrl)) throw new Error('terminology_base_url_invalid');
    this.#baseUrl = new URL(options.baseUrl);
    if (!['https:', 'http:'].includes(this.#baseUrl.protocol)) throw new Error('terminology_base_url_invalid');
    this.#serviceToken = options.serviceToken?.trim() || undefined;
    if (this.#serviceToken && options.accessTokenProvider) throw new Error('terminology_auth_configuration_invalid');
    this.#accessTokenProvider = options.accessTokenProvider;
    this.#fetch = options.fetchImplementation ?? fetch;
  }

  public async search(input: TerminologyCandidateSearch): Promise<readonly ClinicalTerminologyCandidate[]> {
    const text = input.text.trim();
    const claim = input.claim.trim();
    const sector = input.sector.trim();
    const jurisdiction = input.jurisdiction?.trim().toUpperCase() || '';
    if (text.length < 2 || text.length > 500 || !claim || !sector) {
      throw new Error('terminology_search_invalid');
    }
    const query = new URLSearchParams({
      text,
      language: validLanguage(input.language),
      fhirVersion: input.fhirVersion.trim() || 'R4',
      sector,
      claim,
      limit: String(Math.min(50, Math.max(1, input.limit ?? 20))),
    });
    if (jurisdiction) query.set('jurisdiction', jurisdiction);
    if (input.ncbiTaxonomyId?.trim()) query.set('ncbiTaxonomyId', input.ncbiTaxonomyId.trim());
    if (input.specialty?.trim()) query.set('specialty', input.specialty.trim());
    if (input.system?.trim()) query.set('system', input.system.trim());
    for (const source of input.sources || []) if (source.trim()) query.append('source', source.trim());
    const url = new URL('/v1/terminology/candidates', this.#baseUrl);
    url.search = query.toString();
    const accessToken = await this.#resolveAccessToken();
    const response = await this.#fetch(url, {
      headers: {
        accept: 'application/vnd.api+json',
        ...(accessToken ? { authorization: `Bearer ${accessToken}` } : {}),
      },
    });
    const body = await response.json().catch(() => undefined) as {
      data?: CandidateResource[];
      meta?: Readonly<{ terminologyVersions?: unknown }>;
      errors?: Array<{ detail?: unknown }>;
    } | undefined;
    if (!response.ok) throw new Error(clean(body?.errors?.[0]?.detail) || `terminology_candidates_http_${response.status}`);
    const terminologyVersions = stringRecord(body?.meta?.terminologyVersions);
    return (body?.data || []).flatMap((resource) => mapResource(resource, input.language, terminologyVersions));
  }

  async #resolveAccessToken(): Promise<string | undefined> {
    if (this.#serviceToken) return this.#serviceToken;
    if (!this.#accessTokenProvider) return undefined;
    const token = clean(await this.#accessTokenProvider());
    if (!token) throw new Error('terminology_access_token_unavailable');
    return token;
  }
}

function mapResource(
  resource: CandidateResource,
  requestedLanguage: string,
  terminologyVersions: Readonly<Record<string, string>>,
): ClinicalTerminologyCandidate[] {
  const system = clean(resource.id);
  if (!system) return [];
  const sources = Array.isArray(resource.meta?.sources) ? resource.meta.sources.map(clean).filter(Boolean) : [];
  const source = sources[0] || system;
  const terminologyVersion = clean(resource.meta?.versionId)
    || clean(resource.meta?.terminologyVersion)
    || clean(terminologyVersions[system]);
  return Object.entries(resource.attributes || {}).flatMap(([code, rawValue]) => {
    const value = clean(rawValue);
    if (!code.trim() || !value) return [];
    const labels = resource.meta?.labels?.[code];
    return [{
      source,
      system,
      code: code.trim(),
      text: clean(labels?.text) || value,
      display: clean(labels?.display) || value,
      language: clean(labels?.textLanguage) || validLanguage(requestedLanguage),
      ...(terminologyVersion ? { terminologyVersion } : {}),
    }];
  });
}

function validLanguage(value: string): string {
  const language = value.trim();
  return /^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/.test(language) ? language : 'en';
}

function clean(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function stringRecord(value: unknown): Readonly<Record<string, string>> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).flatMap(([key, item]) => {
    const text = clean(item);
    return text ? [[key, text]] : [];
  }));
}
