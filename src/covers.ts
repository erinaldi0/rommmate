/**
 * Cover art: fetching, caching and resolution to a drawable source.
 *
 * RomM serves artwork as static files under `/assets/...`, but an instance
 * can be configured to require the API token for those as well — and
 * react-tela's `<Image>` cannot send an `Authorization` header. So the bytes
 * are fetched here, with the token, and handed to the renderer as a local
 * file.
 *
 * Two storage backends, picked at runtime:
 *   - nx.js on the Switch: `sdmc:/rommate/covers/<hash>.<ext>`
 *   - browser preview harness: an object URL (no filesystem available)
 *
 * Every failure path is silent by design: a missing or broken cover must
 * never take the app down, it just means the tile keeps its placeholder.
 */
/** The subset of the nx.js `Switch` namespace that the cache needs. */
interface SwitchLike {
	writeFile(path: string, data: string | BufferSource): Promise<void>;
	readFile(path: string): Promise<ArrayBuffer | null>;
}

function switchApi(): SwitchLike | null {
	const g = globalThis as unknown as { Switch?: SwitchLike };
	return typeof g.Switch?.writeFile === 'function' ? g.Switch : null;
}

const CACHE_DIR = 'sdmc:/rommate/covers';

/** url → local source that `<Image>` can draw. */
const resolved = new Map<string, string>();
/** url → in-flight resolution, so one cover is never fetched twice. */
const inFlight = new Map<string, Promise<string>>();

let authToken = '';

/** Sets the bearer token used for artwork requests. */
export function configureCovers(token: string): void {
	authToken = token;
}

/** True when the artwork for `url` is already available locally. */
export function hasCover(url: string): boolean {
	return resolved.has(url);
}

/**
 * Resolves an artwork URL to something `<Image>` can draw.
 *
 * Returns an empty string when the artwork cannot be fetched — callers are
 * expected to fall back to a placeholder.
 */
export function resolveCover(url: string): Promise<string> {
	if (url === '') return Promise.resolve('');

	const cached = resolved.get(url);
	if (cached !== undefined) return Promise.resolve(cached);

	const pending = inFlight.get(url);
	if (pending !== undefined) return pending;

	const job = fetchAndStore(url).then(
		(src) => {
			inFlight.delete(url);
			if (src !== '') resolved.set(url, src);
			return src;
		},
		() => {
			inFlight.delete(url);
			return '';
		},
	);

	inFlight.set(url, job);
	return job;
}

/** FNV-1a — short, stable, and good enough to key a cache file. */
function hashUrl(url: string): string {
	let h = 0x811c9dc5;
	for (let i = 0; i < url.length; i++) {
		h ^= url.charCodeAt(i);
		h = Math.imul(h, 0x01000193) >>> 0;
	}
	return h.toString(16).padStart(8, '0');
}

function extensionFor(url: string, contentType: string): string {
	const fromUrl = /\.([a-z0-9]{2,4})(?:[?#]|$)/i.exec(url)?.[1]?.toLowerCase();
	if (fromUrl === 'png' || fromUrl === 'webp') return fromUrl;
	if (fromUrl === 'jpg' || fromUrl === 'jpeg') return 'jpg';
	if (contentType.includes('png')) return 'png';
	if (contentType.includes('webp')) return 'webp';
	if (contentType.includes('jpeg')) return 'jpg';
	return 'png';
}

async function fetchAndStore(url: string): Promise<string> {
	const headers: Record<string, string> = {};
	if (authToken !== '') headers.Authorization = `Bearer ${authToken}`;

	let res: Response;
	try {
		res = await fetch(url, { headers });
	} catch {
		return '';
	}
	if (!res.ok) return '';

	let bytes: ArrayBuffer;
	try {
		bytes = await res.arrayBuffer();
	} catch {
		return '';
	}
	if (bytes.byteLength === 0) return '';

	let contentType = '';
	try {
		contentType = res.headers?.get?.('content-type') ?? '';
	} catch {
		contentType = '';
	}

	const sw = switchApi();
	if (sw !== null) {
		const path = `${CACHE_DIR}/${hashUrl(url)}.${extensionFor(url, contentType)}`;
		try {
			// A copy on the SD card survives restarts, so the artwork is
			// pulled from RomM only once per cover.
			const existing = await sw.readFile(path);
			if (existing !== null && existing.byteLength > 0) return path;
		} catch {
			/* no SD card, or no file yet — fall through to the network copy */
		}
		try {
			await sw.writeFile(path, bytes);
			return path;
		} catch {
			return '';
		}
	}

	// Browser preview harness: keep the bytes in an object URL.
	const blobCtor = (globalThis as { Blob?: typeof Blob }).Blob;
	const urlApi = (globalThis as { URL?: { createObjectURL?: (b: Blob) => string } }).URL;
	if (blobCtor && typeof urlApi?.createObjectURL === 'function') {
		try {
			return urlApi.createObjectURL(new blobCtor([bytes], { type: contentType || 'image/png' }));
		} catch {
			return '';
		}
	}

	return '';
}

/** Test seam: forget every cached cover (used by the preview harness). */
export function resetCoverCache(): void {
	resolved.clear();
	inFlight.clear();
}

/** Exposed for diagnostics: how many covers are cached in memory. */
export function coverCacheSize(): number {
	return resolved.size;
}
