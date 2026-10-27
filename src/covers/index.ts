/**
 * Cover art: fetching, caching and resolution to a drawable source.
 *
 * RomM serves artwork as static files under `/assets/...`, but an instance
 * can be configured to require the API token for those as well — and
 * react-tela's `<Image>` cannot send an `Authorization` header. So the
 * bytes are fetched here, with the token, and handed to the renderer as a
 * local file.
 *
 * Memory on-device is the binding constraint: nx.js pulls a whole image
 * file into memory to decode it, and every drawn `<Image>` keeps a full
 * RGBA copy of its source at the image's natural size. So the cache is
 * shaped for it:
 *   - the SD copy is checked BEFORE the network — art is pulled from RomM
 *     once, ever;
 *   - the cached master copy is capped at MAX_DIM, whatever the server's
 *     original size — it is the on-disk source of truth;
 *   - on top of the master, one file per (size, fit) the app actually
 *     draws is derived from it: a 108x144 dashboard cover decodes to
 *     108x144, so the `<Image>` paints 1:1 instead of resampling a
 *     640-px bitmap every frame;
 *   - at most MAX_FETCHES downloads run at once, so a fast scroll cannot
 *     pile up unbounded in-flight buffers (unbounded fan-out of full-size
 *     covers ended in the native "Out of memory (failed to allocate …)"
 *     RangeError on hardware).
 *
 * Two storage backends, picked at runtime:
 *   - nx.js on the Switch: `sdmc:/switch/rommmate/covers/<hash>.png`
 *   - browser preview harness: an object URL (no filesystem available)
 *
 * Every failure path is silent by design: a missing or broken cover must
 * never take the app down, it just means the tile keeps its placeholder —
 * and when the downscale pipeline cannot run, the original bytes are
 * cached as-is (the nx.js decoder sniffs content, so the extension is
 * only a label).
 *
 * The decode → scale → PNG-encode pipeline itself lives in `pipeline.ts`;
 * this module owns the cache, the fetch queue, and the public API
 * (`configureCovers`, `resolveCover`, `prefetchCovers`, …) that the rest
 * of the app — and `./covers` from outside — imports.
 */
import { setActivity } from '../activity';
import { masterPng, preparePng } from './pipeline';
import { log } from '../log';
import { memSnapshot } from '../mem';
/** The subset of the nx.js `Switch` namespace that the cache needs. */
interface SwitchLike {
	writeFile(path: string, data: string | BufferSource): Promise<void>;
	readFile(path: string): Promise<ArrayBuffer | null>;
}

function switchApi(): SwitchLike | null {
	const g = globalThis as unknown as { Switch?: SwitchLike };
	return typeof g.Switch?.writeFile === 'function' ? g.Switch : null;
}

/** How a source image is fitted into the box it is drawn into. */
export type Fit = 'cover' | 'contain';

/** One artwork the UI wants drawn into a box of its own. */
export interface CoverRequest {
	url: string;
	width: number;
	height: number;
	/** How the artwork is fitted. @default 'cover' */
	fit?: Fit;
}

const CACHE_DIR = 'sdmc:/switch/rommmate/covers';

/**
 * How many artwork downloads may be in flight at once. Each one holds the
 * original file bytes in memory until the (downscaled) copy is written, so
 * an unbounded fan-out across a fast scroll could stack dozens of
 * multi-megabyte buffers at once — the native "Out of memory (failed to
 * allocate …)" RangeError on hardware. Two, not four: the dashboard can
 * queue ~27 tiles at once, and the queue must drain without ever stacking
 * more than a couple of decodes.
 */
const MAX_FETCHES = 2;

/** (url, size, fit) → local source that `<Image>` can draw. */
const resolved = new Map<string, string>();
/** (url, size, fit) → in-flight resolution, so one is never fetched twice. */
const inFlight = new Map<string, Promise<string>>();

/** The cache key: one artwork is a different image at every size and fit. */
function keyOf(url: string, width: number, height: number, fit: Fit): string {
	return `${url}#${width}x${height}${fit === 'contain' ? ':contain' : ''}`;
}

let authToken = '';
/** The RomM instance's base URL — the token only ever goes to it. */
let instanceBase = '';

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

/**
 * Sets the bearer token (and the instance it belongs to) used for artwork
 * requests. The token is only sent to the instance itself: artwork hosted
 * elsewhere (IGDB platform logos) must not see it, and in the browser
 * preview the header would trip a CORS preflight the host never answers.
 */
export function configureCovers(token: string, baseUrl: string): void {
	authToken = token;
	instanceBase = baseUrl;
}

/**
 * True when the artwork for `url` is already available locally *for that
 * box*: a cached 108×144 copy does not satisfy a 216×288 request.
 */
export function hasCover(url: string, width: number, height: number, fit: Fit = 'cover'): boolean {
	return resolved.has(keyOf(url, width, height, fit));
}

/**
 * Resolves an artwork URL to something `<Image>` can draw into the given
 * box.
 *
 * The box and fit are part of the identity of the artwork (see the module
 * comment): the returned source is the display-sized copy, so the renderer
 * paints it 1:1.
 *
 * Returns an empty string when the artwork cannot be fetched — callers are
 * expected to fall back to a placeholder.
 */
export function resolveCover(url: string, width: number, height: number, fit: Fit = 'cover'): Promise<string> {
	if (url === '') return Promise.resolve('');

	const key = keyOf(url, width, height, fit);
	const cached = resolved.get(key);
	if (cached !== undefined) return Promise.resolve(cached);

	const pending = inFlight.get(key);
	if (pending !== undefined) return pending;

	const job = fetchAndStore(url, width, height, fit).then(
		(src) => {
			inFlight.delete(key);
			if (src !== '') resolved.set(key, src);
			syncArtworkActivity();
			// Every 25th resolution: a light growth probe of the artwork
			// layer (enough to see it climbing over a long idle session
			// without flooding the log during fast scrolls).
			if (resolved.size % 25 === 0) {
				log('covers', `resolved${resolved.size} inflight${inFlight.size} ${memSnapshot()}`);
			}
			return src;
		},
		() => {
			inFlight.delete(key);
			syncArtworkActivity();
			return '';
		},
	);

	inFlight.set(key, job);
	syncArtworkActivity();
	return job;
}

/**
 * Warms the cache for a batch of boxes and their artwork.
 *
 * The grid calls this for the rows around the viewport, so a cover arrives
 * roughly when its row scrolls into view. Every request is deduplicated
 * internally and every failure is silent, exactly like `resolveCover` —
 * a prefetch is a hint, not a requirement.
 */
export function prefetchCovers(requests: CoverRequest[]): void {
	for (const r of requests) {
		if (r.url === '') continue;
		void resolveCover(r.url, r.width, r.height, r.fit ?? 'cover');
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

/** The SD file that holds the master copy of `url`. */
function masterPath(url: string): string {
	return `${CACHE_DIR}/${hashUrl(url)}.png`;
}

/** The SD file that holds a derived copy for one (size, fit). */
function derivedPath(url: string, width: number, height: number, fit: Fit): string {
	return `${CACHE_DIR}/${hashUrl(url)}-${width}x${height}${fit === 'contain' ? 'c' : ''}.png`;
}

/** Probes the SD cache for a derived copy; null when there is none. */
async function readDerived(sw: SwitchLike, url: string, width: number, height: number, fit: Fit): Promise<string | null> {
	const path = derivedPath(url, width, height, fit);
	try {
		const existing = await sw.readFile(path);
		if (existing !== null && existing.byteLength > 0) return path;
	} catch {
		/* a missing file is the normal case */
	}
	return null;
}

async function fetchAndStore(url: string, width: number, height: number, fit: Fit): Promise<string> {
	const sw = switchApi();

	// The SD cache is checked BEFORE the network: artwork RomM has already
	// served once must never be downloaded again. (The old order — fetch
	// first, consult the card after — re-pulled every cover on every
	// launch: slow, and the app's biggest recurring memory churn.)
	if (sw !== null) {
		// The exact copy for this (size, fit) wins: nothing to do.
		const derived = await readDerived(sw, url, width, height, fit);
		if (derived !== null) return derived;

		// A master copy can answer without any network: derive the
		// requested size from it. A master smaller than the box is used
		// as-is — the `<Image>` stretches, which is all that source has.
		const master = await readCached(sw, url);
		if (master !== null) {
			const bytes = await sw.readFile(master).catch(() => null);
			if (bytes !== null) {
				const png = await preparePng(bytes, width, height, fit);
				if (png === null) return master;
				const path = derivedPath(url, width, height, fit);
				try {
					await sw.writeFile(path, png);
				} catch {
					return master; // the derivation is a nicety; the master still draws
				}
				return path;
			}
		}
	}

	return withFetchSlot(() => downloadAndStore(url, sw, width, height, fit));
}

async function downloadAndStore(url: string, sw: SwitchLike | null, width: number, height: number, fit: Fit): Promise<string> {
	const headers: Record<string, string> = {};
	// RomM can require the token for its own /assets files, but the token
	// belongs to the instance: external artwork (IGDB platform logos) is
	// fetched anonymously — a custom Authorization header would also trip
	// a CORS preflight in the browser preview that the host never answers.
	const onInstance = instanceBase === '' || url.startsWith(instanceBase);
	if (authToken !== '' && onInstance) headers.Authorization = `Bearer ${authToken}`;

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
		// Browser preview harness: no filesystem, so the artwork lives in
		// an object URL. A 'cover' fit needs no derivation there (the
		// browser resamples natively, exactly as the `<Image>` would); a
		// 'contain' fit must be baked in, because the `<Image>` always
		// stretches its source to the whole box.
		let out: ArrayBuffer = bytes;
		let type = contentType || 'image/png';
		if (fit === 'contain') {
			const png = await preparePng(bytes, width, height, 'contain');
			if (png !== null) {
				out = png;
				type = 'image/png';
			}
		}
		const blobCtor = (globalThis as { Blob?: typeof Blob }).Blob;
		const urlApi = (globalThis as { URL?: { createObjectURL?: (b: Blob) => string } }).URL;
		if (blobCtor && typeof urlApi?.createObjectURL === 'function') {
			try {
				return urlApi.createObjectURL(new blobCtor([out], { type }));
			} catch {
				return '';
			}
		}
		return '';
	}

	// Device: two files. The master is capped at MAX_DIM (or the original
	// when it is already smaller) and stays the on-disk source of truth
	// for every other size this artwork may be drawn at later. The derived
	// copy is exactly the requested box, so the `<Image>` paints 1:1 and
	// never resamples. Any step may fail (huge, corrupt or unsupported
	// image) — the master is then the drawable copy: a big cover still
	// beats a missing one.
	let masterStored = false;
	const masterBytes = (await masterPng(bytes)) ?? bytes;
	try {
		await sw.writeFile(masterPath(url), masterBytes);
		masterStored = true;
	} catch {
		/* without a card copy the download is still usable below */
	}

	const png = await preparePng(masterBytes, width, height, fit);
	if (png === null) return masterStored ? masterPath(url) : '';
	const path = derivedPath(url, width, height, fit);
	try {
		await sw.writeFile(path, png);
		return path;
	} catch {
		return masterStored ? masterPath(url) : '';
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
