import { TerminologyCandidateClient, type TerminologyAccessTokenProvider } from './candidate-client.js';

export type CodeCandidate = Readonly<{
  /** Optional provider/source provenance. It is not the canonical Coding.system URI. */
  source?: string;
  system: string;
  code: string;
  /** Label in the requested language, or the service fallback. */
  text: string;
  /** Canonical English label. */
  display: string;
  language: string;
  terminologyVersion?: string;
  fallbackUsed?: boolean;
}>;

export type TerminologyParameterContext = Readonly<{
  /** Canonical resource-qualified FHIR SearchParameter name, for example Condition.code. */
  param?: string;
  /** Compatible alias used by flat-claim integrations. Prefer param in new BFF code. */
  claim?: string;
  sector: string;
  jurisdiction?: string;
  language?: string;
}>;

export interface TerminologyCache {
  get<T>(key: string): Promise<T | undefined>;
  set<T>(key: string, value: T, ttlMs: number): Promise<void>;
}

/** Small process-local cache. Supply a shared cache adapter when BFF replicas must share entries. */
export class MemoryTerminologyCache implements TerminologyCache {
  readonly #entries = new Map<string, Readonly<{ expiresAt: number; value: unknown }>>();
  readonly #maxEntries: number;

  public constructor(options: Readonly<{ maxEntries?: number }> = {}) {
    this.#maxEntries = Math.max(1, options.maxEntries ?? 1_000);
  }

  public async get<T>(key: string): Promise<T | undefined> {
    const entry = this.#entries.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt <= Date.now()) {
      this.#entries.delete(key);
      return undefined;
    }
    this.#entries.delete(key);
    this.#entries.set(key, entry);
    return entry.value as T;
  }

  public async set<T>(key: string, value: T, ttlMs: number): Promise<void> {
    this.#entries.delete(key);
    this.#entries.set(key, { expiresAt: Date.now() + Math.max(1, ttlMs), value });
    while (this.#entries.size > this.#maxEntries) {
      const oldest = this.#entries.keys().next().value as string | undefined;
      if (!oldest) break;
      this.#entries.delete(oldest);
    }
  }
}

type JsonApiResponse = Readonly<{
  data?: unknown;
  meta?: Readonly<Record<string, unknown>>;
  errors?: readonly Readonly<{ detail?: unknown }>[];
}>;

/**
 * High-level server-only client used by portal BFFs.
 *
 * Product policy selects sector, jurisdiction and SearchParameter. The SDK keeps
 * the terminology service's legacy wire parameters out of application code.
 */
export class TerminologyClient {
  readonly #baseUrl: URL;
  readonly #serviceToken: string | undefined;
  readonly #accessTokenProvider: TerminologyAccessTokenProvider | undefined;
  readonly #fetch: typeof fetch;
  readonly #cache: TerminologyCache;
  readonly #candidateTtlMs: number;
  readonly #stableTtlMs: number;

  public constructor(options: Readonly<{
    baseUrl: string;
    serviceToken?: string;
    accessTokenProvider?: TerminologyAccessTokenProvider;
    fetchImplementation?: typeof fetch;
    cache?: TerminologyCache;
    candidateTtlMs?: number;
    stableTtlMs?: number;
  }>) {
    if (!URL.canParse(options.baseUrl)) throw new Error('terminology_base_url_invalid');
    this.#baseUrl = new URL(options.baseUrl);
    if (!['https:', 'http:'].includes(this.#baseUrl.protocol)) throw new Error('terminology_base_url_invalid');
    this.#serviceToken = options.serviceToken?.trim() || undefined;
    if (this.#serviceToken && options.accessTokenProvider) throw new Error('terminology_auth_configuration_invalid');
    this.#accessTokenProvider = options.accessTokenProvider;
    this.#fetch = options.fetchImplementation ?? fetch;
    this.#cache = options.cache ?? new MemoryTerminologyCache();
    this.#candidateTtlMs = positiveTtl(options.candidateTtlMs, 5 * 60_000);
    this.#stableTtlMs = positiveTtl(options.stableTtlMs, 24 * 60 * 60_000);
  }

  public async searchCodeCandidatesFromText(input: TerminologyParameterContext & Readonly<{
    text: string;
    systems?: readonly string[];
    /** Optional governed provider/source scopes. Coding systems normally suffice. */
    sources?: readonly string[];
    limit?: number;
    ncbiTaxonomyId?: string;
    specialty?: string;
  }>): Promise<readonly CodeCandidate[]> {
    const context = normalizedContext(input);
    const text = input.text.trim();
    if (text.length < 2 || text.length > 160) throw new Error('terminology_search_invalid');
    const systems = unique(input.systems?.map((system) => validSystem(system)) ?? []);
    const sources = unique(input.sources?.map(clean).filter(Boolean) ?? []);
    const key = cacheKey('candidates', { ...context, text, systems, sources, limit: input.limit, ncbiTaxonomyId: clean(input.ncbiTaxonomyId), specialty: clean(input.specialty) });
    return this.#cached(key, this.#candidateTtlMs, async () => {
      const client = new TerminologyCandidateClient({
        baseUrl: this.#baseUrl.href,
        ...(this.#serviceToken ? { serviceToken: this.#serviceToken } : {}),
        ...(this.#accessTokenProvider ? { accessTokenProvider: this.#accessTokenProvider } : {}),
        fetchImplementation: this.#fetch,
      });
      const searches = systems.length ? systems.map((system) => system) : [undefined];
      const groups = await Promise.all(searches.map((system) => client.search({
        text,
        language: context.language,
        fhirVersion: 'R4',
        sector: context.sector,
        jurisdiction: context.jurisdiction,
        claim: context.param,
        limit: input.limit,
        ...(sources.length ? { sources } : {}),
        ...(system ? { system } : {}),
        ...(clean(input.ncbiTaxonomyId) ? { ncbiTaxonomyId: clean(input.ncbiTaxonomyId) } : {}),
        ...(clean(input.specialty) ? { specialty: clean(input.specialty) } : {}),
      })));
      const candidates: CodeCandidate[] = groups.flat().map((candidate) => ({
        source: candidate.source,
        system: candidate.system,
        code: candidate.code,
        text: candidate.text || candidate.display,
        display: candidate.display,
        language: candidate.language || context.language,
        ...(candidate.terminologyVersion ? { terminologyVersion: candidate.terminologyVersion } : {}),
      }));
      return deduplicate(candidates, (candidate) => `${candidate.system}\0${candidate.code}`);
    });
  }

  /** Expands every page of the governed ValueSet used to compose a dropdown. */
  public async getCodeOptionsForParameter(input: TerminologyParameterContext & Readonly<{
    pageSize?: number;
    version?: string;
  }>): Promise<readonly CodeCandidate[]> {
    const context = normalizedContext(input);
    const pageSize = Math.min(100, Math.max(1, input.pageSize ?? 100));
    const version = clean(input.version);
    const key = cacheKey('options', { ...context, pageSize, version });
    return this.#cached(key, this.#stableTtlMs, async () => {
      const options: CodeCandidate[] = [];
      let offset = 0;
      let total = Number.POSITIVE_INFINITY;
      let versions: Readonly<Record<string, string>> = {};
      while (offset < total) {
        const query = wireContext(context);
        query.set('offset', String(offset));
        query.set('count', String(pageSize));
        if (version) query.set('version', version);
        const body = await this.#get('/v1/terminology/value-set-options', query);
        const resources = Array.isArray(body.data) ? body.data : [];
        const pageVersions = stringRecord(body.meta?.terminologyVersions);
        versions = { ...versions, ...pageVersions };
        for (const resource of resources) {
          const attributes = record(record(resource).attributes);
          const system = clean(attributes.system);
          const code = clean(attributes.code);
          const display = clean(attributes.display);
          const text = clean(attributes.localizedDisplay) || display;
          if (!system || !code || !display || !text) continue;
          options.push({
            system, code, text, display,
            language: clean(attributes.resolvedLanguage) || context.language,
            fallbackUsed: attributes.fallbackUsed === true,
            ...(versions[system] ? { terminologyVersion: versions[system] } : {}),
          });
        }
        total = finiteNonNegative(body.meta?.total, options.length);
        if (!resources.length) break;
        offset += resources.length;
      }
      return options.map((option) => option.terminologyVersion || !versions[option.system]
        ? option
        : { ...option, terminologyVersion: versions[option.system] });
    });
  }

  public async resolveCodeLabels(input: TerminologyParameterContext & Readonly<{
    system: string;
    code: string;
    version?: string;
  }>): Promise<CodeCandidate | undefined> {
    const context = normalizedContext(input);
    const system = validSystem(input.system);
    const code = input.code.trim();
    if (!code || code.length > 160) throw new Error('terminology_code_invalid');
    const version = clean(input.version);
    const key = cacheKey('labels', { ...context, system, code, version });
    return this.#cached(key, this.#stableTtlMs, async () => {
      const query = wireContext(context);
      query.set('system', system);
      query.set('code', code);
      if (version) query.set('version', version);
      const body = await this.#get('/v1/terminology/labels', query);
      if (!body.data) return undefined;
      const attributes = record(record(body.data).attributes);
      const display = clean(attributes.display);
      const text = clean(attributes.text) || display;
      if (!display || !text) return undefined;
      const resolvedSystem = clean(attributes.system) || system;
      const resolvedCode = clean(attributes.code) || code;
      if (resolvedSystem !== system || resolvedCode !== code) {
        throw new Error('terminology_exact_code_mismatch');
      }
      return {
        system: resolvedSystem,
        code: resolvedCode,
        text,
        display,
        language: clean(attributes.textLanguage) || context.language,
        ...(clean(attributes.terminologyVersion) ? { terminologyVersion: clean(attributes.terminologyVersion) } : {}),
      };
    });
  }

  async #get(path: string, query: URLSearchParams): Promise<JsonApiResponse> {
    const url = new URL(path, this.#baseUrl);
    url.search = query.toString();
    const response = await this.#fetch(url, { headers: await this.#headers() });
    const body = await response.json().catch(() => undefined) as JsonApiResponse | undefined;
    if (!response.ok) throw new Error(clean(body?.errors?.[0]?.detail) || `terminology_http_${response.status}`);
    return body ?? {};
  }

  async #headers(): Promise<Readonly<Record<string, string>>> {
    const accessToken = await this.#resolveAccessToken();
    return {
      accept: 'application/vnd.api+json',
      ...(accessToken ? { authorization: `Bearer ${accessToken}` } : {}),
    };
  }

  async #resolveAccessToken(): Promise<string | undefined> {
    if (this.#serviceToken) return this.#serviceToken;
    if (!this.#accessTokenProvider) return undefined;
    const token = clean(await this.#accessTokenProvider());
    if (!token) throw new Error('terminology_access_token_unavailable');
    return token;
  }

  async #cached<T>(key: string, ttlMs: number, load: () => Promise<T>): Promise<T> {
    const cached = await this.#cache.get<T>(key);
    if (cached !== undefined) return cached;
    const value = await load();
    await this.#cache.set(key, value, ttlMs);
    return value;
  }
}

type NormalizedContext = Readonly<{ param: string; sector: string; jurisdiction: string; language: string }>;

function normalizedContext(input: TerminologyParameterContext): NormalizedContext {
  const param = clean(input.param) || clean(input.claim);
  if (clean(input.param) && clean(input.claim) && clean(input.param) !== clean(input.claim)) {
    throw new Error('terminology_parameter_context_invalid');
  }
  const sector = input.sector.trim();
  const jurisdiction = clean(input.jurisdiction).toUpperCase();
  if (!/^[A-Z][A-Za-z0-9]*\.[A-Za-z][A-Za-z0-9.-]*$/.test(param) || !sector) {
    throw new Error('terminology_parameter_context_invalid');
  }
  return { param, sector, jurisdiction, language: validLanguage(input.language ?? 'en') };
}

function wireContext(input: NormalizedContext): URLSearchParams {
  return new URLSearchParams({
    language: input.language,
    fhirVersion: 'R4',
    sector: input.sector,
    jurisdiction: input.jurisdiction,
    claim: input.param,
  });
}

function cacheKey(operation: string, input: unknown): string {
  return `terminology:v1:${operation}:${JSON.stringify(input)}`;
}

function positiveTtl(value: number | undefined, fallback: number): number {
  return Number.isFinite(value) && value! > 0 ? value! : fallback;
}

function validLanguage(value: string): string {
  const language = value.trim();
  return /^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/.test(language) ? language : 'en';
}

function validSystem(value: string): string {
  const system = value.trim();
  if (!URL.canParse(system)) throw new Error('terminology_system_invalid');
  return system;
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)];
}

function deduplicate<T>(values: readonly T[], key: (value: T) => string): T[] {
  const seen = new Set<string>();
  return values.filter((value) => {
    const id = key(value);
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function stringRecord(value: unknown): Readonly<Record<string, string>> {
  return Object.fromEntries(Object.entries(record(value)).flatMap(([key, item]) => {
    const text = clean(item);
    return text ? [[key, text]] : [];
  }));
}

function finiteNonNegative(value: unknown, fallback: number): number {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : fallback;
}

function clean(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}
