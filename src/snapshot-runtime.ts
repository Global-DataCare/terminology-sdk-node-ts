import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  parseTerminologyManifest,
  parseTerminologySnapshot,
  type TerminologyManifestEntry,
  type TerminologySnapshot,
} from 'terminology-data-utils-ts';
import {
  TerminologySnapshotRegistryMemory,
  type TerminologyEntrySelection,
  type TerminologySearchInput,
} from 'terminology-sdk-core-ts';

export type TerminologySynchronizationStatus = 'current' | 'updated';

type ActivePointer = Readonly<{ snapshotId: string; sha256: string }>;

function sha256(value: Uint8Array | string): string {
  return createHash('sha256').update(value).digest('hex');
}

function pointerName(snapshotId: string): string {
  return `${sha256(snapshotId)}.json`;
}

/** Node BFF runtime for verified snapshot synchronization and offline lookup. */
export class TerminologySnapshotRuntimeNode {
  readonly #manifestUrl: URL;
  readonly #cacheDirectory: string;
  readonly #serviceToken: string | undefined;
  readonly #fetch: typeof fetch;
  readonly #registry = new TerminologySnapshotRegistryMemory();

  public constructor(options: Readonly<{
    manifestUrl: string;
    cacheDirectory: string;
    serviceToken?: string;
    fetchImplementation?: typeof fetch;
  }>) {
    if (!URL.canParse(options.manifestUrl)) throw new Error('terminology_manifest_url_invalid');
    if (!options.cacheDirectory.trim()) throw new Error('terminology_cache_directory_required');
    this.#manifestUrl = new URL(options.manifestUrl);
    if (this.#manifestUrl.protocol !== 'https:' && this.#manifestUrl.protocol !== 'http:') {
      throw new Error('terminology_manifest_url_invalid');
    }
    this.#cacheDirectory = options.cacheDirectory;
    this.#serviceToken = options.serviceToken?.trim() || undefined;
    this.#fetch = options.fetchImplementation ?? fetch;
  }

  public async synchronize(snapshotId: string): Promise<TerminologySynchronizationStatus> {
    const manifestResponse = await this.#fetch(this.#manifestUrl, {
      headers: this.#headers(true),
    });
    if (!manifestResponse.ok) throw new Error(`terminology_manifest_http_${manifestResponse.status}`);
    const manifest = parseTerminologyManifest(await manifestResponse.json());
    const entry = manifest.snapshots.find((candidate) => candidate.id === snapshotId);
    if (!entry) throw new Error('terminology_snapshot_not_listed');

    const pointer = await this.#readPointer(snapshotId);
    if (pointer?.sha256 === entry.sha256) {
      await this.load(snapshotId);
      return 'current';
    }

    const downloadUrl = new URL(entry.downloadUrl);
    if (downloadUrl.protocol !== 'https:' && downloadUrl.protocol !== 'http:') {
      throw new Error('terminology_snapshot_download_url_invalid');
    }
    const response = await this.#fetch(downloadUrl, {
      headers: this.#headers(downloadUrl.origin === this.#manifestUrl.origin),
    });
    if (!response.ok) throw new Error(`terminology_snapshot_http_${response.status}`);
    const bytes = new Uint8Array(await response.arrayBuffer());
    const snapshot = this.#verify(entry, bytes);
    await this.#activate(entry, bytes, snapshot);
    return 'updated';
  }

  /** Loads and re-verifies the last active local snapshot without network access. */
  public async load(snapshotId: string): Promise<void> {
    const pointer = await this.#readPointer(snapshotId);
    if (!pointer) throw new Error('terminology_snapshot_not_cached');
    const bytes = new Uint8Array(await readFile(this.#objectPath(pointer.sha256)));
    if (sha256(bytes) !== pointer.sha256) throw new Error('terminology_snapshot_sha256_mismatch');
    const snapshot = parseTerminologySnapshot(JSON.parse(Buffer.from(bytes).toString('utf8')));
    if (snapshot.id !== snapshotId) throw new Error('terminology_snapshot_id_mismatch');
    this.#registry.activate(snapshot);
  }

  public search(snapshotId: string, input: TerminologySearchInput) {
    return this.#registry.search(snapshotId, input);
  }

  /** Returns the complete cached entries applicable to one flat-claim editor. */
  public entries(snapshotId: string, input: TerminologyEntrySelection) {
    return this.#registry.entries(snapshotId, input);
  }

  #headers(includeAuthorization: boolean): Headers {
    const headers = new Headers({ accept: 'application/json' });
    if (includeAuthorization && this.#serviceToken) {
      headers.set('authorization', `Bearer ${this.#serviceToken}`);
    }
    return headers;
  }

  #verify(entry: TerminologyManifestEntry, bytes: Uint8Array): TerminologySnapshot {
    if (bytes.byteLength !== entry.byteLength) throw new Error('terminology_snapshot_byte_length_mismatch');
    if (sha256(bytes) !== entry.sha256) throw new Error('terminology_snapshot_sha256_mismatch');
    let value: unknown;
    try {
      value = JSON.parse(Buffer.from(bytes).toString('utf8'));
    } catch {
      throw new Error('terminology_snapshot_json_invalid');
    }
    const snapshot = parseTerminologySnapshot(value);
    if (snapshot.id !== entry.id) throw new Error('terminology_snapshot_id_mismatch');
    return snapshot;
  }

  async #activate(entry: TerminologyManifestEntry, bytes: Uint8Array, snapshot: TerminologySnapshot): Promise<void> {
    const objectsDirectory = join(this.#cacheDirectory, 'objects');
    const activeDirectory = join(this.#cacheDirectory, 'active');
    await mkdir(objectsDirectory, { recursive: true });
    await mkdir(activeDirectory, { recursive: true });
    await this.#atomicWrite(this.#objectPath(entry.sha256), bytes);
    const pointer: ActivePointer = { snapshotId: entry.id, sha256: entry.sha256 };
    await this.#atomicWrite(
      join(activeDirectory, pointerName(entry.id)),
      Buffer.from(JSON.stringify(pointer)),
    );
    this.#registry.activate(snapshot);
  }

  async #atomicWrite(target: string, bytes: Uint8Array): Promise<void> {
    const temporary = `${target}.${process.pid}.${Date.now()}.tmp`;
    try {
      await writeFile(temporary, bytes, { mode: 0o600 });
      await rename(temporary, target);
    } catch (error) {
      await unlink(temporary).catch(() => undefined);
      throw error;
    }
  }

  async #readPointer(snapshotId: string): Promise<ActivePointer | undefined> {
    const path = join(this.#cacheDirectory, 'active', pointerName(snapshotId));
    const raw = await readFile(path, 'utf8').catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return undefined;
      throw error;
    });
    if (raw === undefined) return undefined;
    const value = JSON.parse(raw) as Partial<ActivePointer>;
    if (value.snapshotId !== snapshotId || typeof value.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(value.sha256)) {
      throw new Error('terminology_snapshot_pointer_invalid');
    }
    return { snapshotId, sha256: value.sha256 };
  }

  #objectPath(digest: string): string {
    if (!/^[a-f0-9]{64}$/.test(digest)) throw new Error('terminology_snapshot_sha256_invalid');
    return join(this.#cacheDirectory, 'objects', `${digest}.json`);
  }
}
