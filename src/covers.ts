/**
 * Cover art: fetching, caching and resolution to a drawable source.
 *
 * RomM serves artwork as static files under `/assets/...`, but an instance
 * can be configured to require the API token for those as well — and
 * react-tela's `<Image>` cannot send an `Authorization` header. So the
 * bytes are fetched here, with the token, and handed to the renderer as a
 * local file.
 *
 * Memory on-device is the binding constraint, so the cache is shaped for
 * it (nx.js pulls a whole image file into memory to decode it, and every
 * drawn `<Image>` keeps a full RGBA copy of its source at the image's
 * natural size):
 *   - the SD copy is checked BEFORE the network — art is pulled from RomM
 *     once, ever;
 *   - art bigger than MAX_DIM is downscaled on first fetch, so the cached
 *     copy is display-sized no matter how large the server's original is;
 *   - at most MAX_FETCHES downloads run at once, so a fast scroll cannot
 *     pile up unbounded in-flight buffers (unbounded fan-out of full-size
 *     covers ended in the native "Out of memory (failed to allocate …)"
 *     RangeError on hardware).
 *
 * Two storage backends, picked at runtime:
 *   - nx.js on the Switch: `sdmc:/rommate/covers/<hash>.png`
 *   - browser preview harness: an object URL (no filesystem available)
 *
 * Every failure path is silent by design: a missing or broken cover must
 * never take the app down, it just means the tile keeps its placeholder —
 * and when the downscale pipeline cannot run, the original bytes are
 * cached as-is (the nx.js decoder sniffs content, so the extension is
 * only a label).
 */
import { setActivity } from './activity';
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

/**
 * Longest edge of a cached image, in pixels. Covers are drawn at most
 * 216×288 (grid) / 200×267 (detail) and screenshots a little over twice
 * that, so 640 keeps every draw crisp while capping the per-image RGBA
 * copy that `drawImage` holds at ~1.5 MiB — full-size server art (scans
 * run into thousands of pixels) was the dominant native-memory consumer
 * while scrolling.
 */
const MAX_DIM = 640;

/**
 * How many artwork downloads may be in flight at once. Each one holds the
 * original file bytes in memory until the (downscaled) copy is written, so
 * an unbounded fan-out across a fast scroll could stack dozens of
 * multi-megabyte buffers at once.
 */
const MAX_FETCHES = 4;

/** url → local source that `<Image>` can draw. */
const resolved = new Map<string, string>();
/** url → in-flight resolution, so one cover is never fetched twice. */
const inFlight = new Map<string, Promise<string>>();

let authToken = '';

let fetchesActive = 0;
const fetchQueue: Array<() => void> = [];

/** Runs `fn` once fewer than MAX_FETCHES fetch jobs are active. */
async function withFetchSlot<T>(fn: () => Promise<T>): Promise<T> {
	if (fetchesActive >= MAX_FETCHES) {
		await new Promise<void>((resolve) => fetchQueue.push(resolve));
	}
	fetchesActive += 1;
	try {
		return await fn();
	} finally {
		fetchesActive -= 1;
		fetchQueue.shift()?.();
	}
}

/**
 * Mirror the in-flight artwork count into the background-activity store,
 * so the top-right badge shows the prefetch working (and goes quiet when
 * the queue drains).
 */
function syncArtworkActivity(): void {
	setActivity('artwork', inFlight.size > 0 ? `Artwork ${inFlight.size} downloading` : null);
}

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
			syncArtworkActivity();
			return src;
		},
		() => {
			inFlight.delete(url);
			syncArtworkActivity();
			return '';
		},
	);

	inFlight.set(url, job);
	syncArtworkActivity();
	return job;
}

/**
 * Warms the cache for a batch of artwork URLs.
 *
 * The grid calls this for the rows around the viewport, so a cover arrives
 * roughly when its row scrolls into view. Every URL is deduplicated
 * internally and every failure is silent, exactly like `resolveCover` —
 * a prefetch is a hint, not a requirement.
 */
export function prefetchCovers(urls: string[]): void {
	for (const url of urls) {
		if (url === '') continue;
		void resolveCover(url);
	}
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

/**
 * Probes the SD cache for `url`; returns the path of a non-empty copy.
 *
 * Fresh copies are `.png`; older builds kept the server's own extension,
 * so those labels are probed too — the decoder sniffs image content, the
 * extension is only a label.
 */
async function readCached(sw: SwitchLike, url: string): Promise<string | null> {
	const hash = hashUrl(url);
	for (const ext of ['png', 'jpg', 'webp']) {
		const path = `${CACHE_DIR}/${hash}.${ext}`;
		try {
			const existing = await sw.readFile(path);
			if (existing !== null && existing.byteLength > 0) return path;
		} catch {
			/* unreadable — treat as a miss */
		}
	}
	return null;
}

async function fetchAndStore(url: string): Promise<string> {
	const sw = switchApi();

	// The SD copy is checked BEFORE the network: artwork RomM has already
	// served once must never be downloaded again. (The old order — fetch
	// first, consult the card after — re-pulled every cover on every
	// launch: slow, and the app's biggest recurring memory churn.)
	if (sw !== null) {
		const cached = await readCached(sw, url);
		if (cached !== null) return cached;
	}

	return withFetchSlot(() => downloadAndStore(url, sw));
}

async function downloadAndStore(url: string, sw: SwitchLike | null): Promise<string> {
	const headers: Record<string, string> = {};
	if (authToken !== '') headers.Authorization = `Bearer ${authToken}`;

	let res: Response;
	try {
		res = await fetch(url, { headers });
	} catch {
		return '';
	}
	if (!res.ok) return '';

	let contentType = '';
	try {
		contentType = res.headers?.get?.('content-type') ?? '';
	} catch {
		contentType = '';
	}

	let bytes: ArrayBuffer;
	try {
		bytes = await res.arrayBuffer();
	} catch {
		return '';
	}
	if (bytes.byteLength === 0) return '';

	if (sw === null) {
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

	// Device: decode → downscale → re-encode, so the SD copy (and every
	// RGBA copy derived from it later) is display-sized. Any step may
	// fail (huge, corrupt or unsupported image) — the original bytes are
	// then cached as-is: a big cover still beats a missing one.
	const path = `${CACHE_DIR}/${hashUrl(url)}.png`;
	const small = await downscaleToPng(bytes);
	try {
		await sw.writeFile(path, small ?? bytes);
		return path;
	} catch {
		return '';
	}
}

/**
 * Decode `bytes` and re-encode them as PNG at ≤MAX_DIM on the long edge.
 *
 * Returns null when the image is already small enough, cannot be decoded,
 * or the platform lacks a piece of the pipeline (the preview harness) —
 * the caller then caches the original bytes. The heavy work (decode,
 * scale, encode) is native; only the small result crosses into JS.
 */
async function downscaleToPng(bytes: ArrayBuffer): Promise<ArrayBuffer | null> {
	const g = globalThis as unknown as {
		Image?: new () => {
			naturalWidth: number;
			naturalHeight: number;
			onload: (() => void) | null;
			onerror: (() => void) | null;
			src: string;
		};
		Blob?: typeof Blob;
		OffscreenCanvas?: new (w: number, h: number) => {
			getContext(id: '2d'): {
				imageSmoothingEnabled: boolean;
				imageSmoothingQuality: string;
				drawImage(img: unknown, x: number, y: number, w: number, h: number): void;
			};
			convertToBlob(opts: { type: string }): Promise<Blob>;
		};
		URL?: {
			createObjectURL?: (b: Blob) => string;
			revokeObjectURL?: (u: string) => void;
		};
	};
	const ImageCtor = g.Image;
	const BlobCtor = g.Blob;
	const CanvasCtor = g.OffscreenCanvas;
	const urlApi = g.URL;
	if (
		typeof ImageCtor !== 'function' ||
		typeof BlobCtor !== 'function' ||
		typeof CanvasCtor !== 'function' ||
		typeof urlApi?.createObjectURL !== 'function'
	) {
		return null;
	}

	let objectUrl = '';
	try {
		objectUrl = urlApi.createObjectURL(new BlobCtor([bytes]));
		const img = new ImageCtor();
		await new Promise<void>((resolve, reject) => {
			img.onload = () => resolve();
			img.onerror = () => reject(new Error('image decode failed'));
			img.src = objectUrl;
		});
		const width = img.naturalWidth;
		const height = img.naturalHeight;
		if (width <= 0 || height <= 0) return null;
		if (Math.max(width, height) <= MAX_DIM) return null;
		const scale = MAX_DIM / Math.max(width, height);
		const w = Math.max(1, Math.round(width * scale));
		const h = Math.max(1, Math.round(height * scale));
		const canvas = new CanvasCtor(w, h);
		const ctx = canvas.getContext('2d');
		ctx.imageSmoothingEnabled = true;
		ctx.imageSmoothingQuality = 'high';
		ctx.drawImage(img, 0, 0, w, h);
		const blob = await canvas.convertToBlob({ type: 'image/png' });
		return await blob.arrayBuffer();
	} catch {
		return null;
	} finally {
		if (objectUrl !== '') {
			try {
				urlApi.revokeObjectURL?.(objectUrl);
			} catch {
				/* ignore */
			}
		}
	}
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
