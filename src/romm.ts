/**
 * RomM REST client — TypeScript port of the v1 C++/libcurl implementation
 * (see git history 6cc4721 for the original; kept as reference for the
 * defensive JSON shapes).
 *
 * Auth: long-lived RomM Client API Token ("rmm_...") sent as
 * `Authorization: Bearer <token>` on every request.
 *
 * Endpoints used:
 *   GET /api/library          — lightweight auth probe (any 200 = valid token)
 *   GET /api/roms?_limit=48   — the game list (name, platform, cover art,
 *                               screenshot, description, genres, release
 *                               date and rom size)
 *
 * RomM versions drift in the details (bare array vs {data: [...]} wrapper,
 * asset values as plain paths vs objects), so parsing stays defensive.
 */

export interface RommGame {
	id: number;
	name: string;
	/** e.g. "Nintendo 64" — empty when unknown. */
	platform: string;
	/** Absolute URL to cover art, or "" when none. */
	coverUrl: string;
	/** Absolute URL to a 16:9 screenshot, or "" when none. */
	screenshotUrl: string;
	/** Long description, or "" when unknown. */
	summary: string;
	/** Release date (`YYYY-MM-DD`), or "" when unknown. */
	releaseDate: string;
	/** Genre names — empty when unknown. */
	genres: string[];
	/** Size of the rom file in bytes; 0 when unknown. */
	sizeBytes: number;
}

/**
 * Read one entry of a RomM `assets` object. Asset values come in two shapes
 * across RomM versions:
 *   "box_2d": "/assets/games/123/abc.png"                  (plain path)
 *   "box_2d": { "path": "/assets/games/123/abc.png", ... } (object)
 */
function assetPath(assets: unknown, key: string): string {
	if (typeof assets !== 'object' || assets === null) return '';

	const v = (assets as Record<string, unknown>)[key];
	if (typeof v === 'string') return v;

	if (typeof v === 'object' && v !== null) {
		const o = v as Record<string, unknown>;
		for (const member of ['path', 'url']) {
			const s = o[member];
			if (typeof s === 'string' && s !== '') return s;
		}
	}

	return '';
}

/** First non-empty string among `keys`. */
function firstString(source: Record<string, unknown>, keys: string[]): string {
	for (const key of keys) {
		const v = source[key];
		if (typeof v === 'string' && v.trim() !== '') return v.trim();
	}
	return '';
}

/** First positive number among `keys` (numbers or numeric strings). */
function firstNumber(source: Record<string, unknown>, keys: string[]): number {
	for (const key of keys) {
		const v = source[key];
		if (typeof v === 'number' && Number.isFinite(v) && v > 0) return v;
		if (typeof v === 'string') {
			const n = Number(v);
			if (Number.isFinite(n) && n > 0) return n;
		}
	}
	return 0;
}

/**
 * Genres arrive as `[{ id, name }]` on current RomM, but some versions (and
 * some imports) use plain strings. Both are accepted.
 */
function parseGenres(value: unknown): string[] {
	if (!Array.isArray(value)) return [];

	const out: string[] = [];
	for (const entry of value) {
		if (typeof entry === 'string') {
			const name = entry.trim();
			if (name !== '') out.push(name);
			continue;
		}
		if (typeof entry === 'object' && entry !== null) {
			const name = (entry as { name?: unknown }).name;
			if (typeof name === 'string' && name.trim() !== '') out.push(name.trim());
		}
	}
	return out;
}

/**
 * RomM reports the release date as a unix timestamp (`first_release`) in
 * some versions and as an ISO string (`release_date`) in others. Both are
 * normalised to `YYYY-MM-DD`; anything implausible is dropped.
 */
function parseReleaseDate(source: Record<string, unknown>): string {
	const iso = firstString(source, ['release_date', 'first_release_date']);
	if (iso !== '') {
		const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
		if (m) return m[0];
		// A bare year is still worth showing.
		const year = /^(\d{4})$/.exec(iso);
		if (year) return year[1];
	}

	const stamp = firstNumber(source, ['first_release']);
	if (stamp <= 0) return '';

	// RomM uses seconds; a millisecond value is ~1000x larger.
	const ms = stamp > 1e11 ? stamp : stamp * 1000;
	const date = new Date(ms);
	if (Number.isNaN(date.getTime())) return '';

	const year = date.getUTCFullYear();
	if (year < 1970 || year > 2100) return '';

	const month = String(date.getUTCMonth() + 1).padStart(2, '0');
	const day = String(date.getUTCDate()).padStart(2, '0');
	return `${year}-${month}-${day}`;
}

export class RommClient {
	#baseUrl: string;
	#token: string;

	constructor(baseUrl: string, token: string) {
		// Normalise: strip trailing slashes so `baseUrl + path` joining never
		// produces "http://host//api/...".
		this.#baseUrl = baseUrl.replace(/\/+$/, '');
		this.#token = token;
	}

	get base(): string {
		return this.#baseUrl;
	}

	#headers(): Record<string, string> {
		return {
			Authorization: `Bearer ${this.#token}`,
			Accept: 'application/json',
		};
	}

	/** Resolve a (possibly relative) RomM asset path to an absolute URL. */
	#absUrl(maybeRelative: string): string {
		if (!maybeRelative) return '';
		if (maybeRelative.startsWith('http://') || maybeRelative.startsWith('https://')) {
			return maybeRelative;
		}
		return this.#baseUrl + (maybeRelative.startsWith('/') ? '' : '/') + maybeRelative;
	}

	/**
	 * Validate the token with a lightweight authenticated GET. RomM
	 * authorises every /api route against the token, so 200 proves the
	 * token works without needing a heavier endpoint.
	 *
	 * @returns null on success, or a human-readable error message.
	 */
	async authenticate(): Promise<string | null> {
		try {
			const res = await fetch(this.#baseUrl + '/api/library', {
				headers: this.#headers(),
			});
			if (res.status === 200) return null;
			if (res.status === 401 || res.status === 403) return 'invalid RomM API token';
			return `server returned HTTP ${res.status}`;
		} catch (err) {
			return `cannot reach RomM (${String(err)})`;
		}
	}

	/**
	 * Fetch the user's game/ROM list (first 48 — the UI only needs the
	 * first screens; pagination comes later).
	 *
	 * @returns the parsed games, and/or a human-readable error.
	 */
	async getGames(): Promise<{ games: RommGame[]; error: string | null }> {
		try {
			const res = await fetch(this.#baseUrl + '/api/roms?_limit=48', {
				headers: this.#headers(),
			});
			if (!res.ok) {
				return { games: [], error: `HTTP ${res.status} from /api/roms` };
			}

			let j: unknown;
			try {
				j = await res.json();
			} catch {
				return { games: [], error: 'malformed JSON from /api/roms' };
			}

			// RomM serves the list either as a bare JSON array or wrapped as
			// { "data": [ ... ], "meta": { ... } } depending on the version.
			let arr: unknown[] | null = null;
			if (Array.isArray(j)) {
				arr = j;
			} else if (
				typeof j === 'object' &&
				j !== null &&
				Array.isArray((j as { data?: unknown }).data)
			) {
				arr = (j as { data: unknown[] }).data;
			}

			if (arr === null) {
				return { games: [], error: 'unexpected response shape from /api/roms' };
			}

			const games: RommGame[] = [];

			for (const entry of arr) {
				// Tolerate garbage entries instead of aborting the whole list.
				if (typeof entry !== 'object' || entry === null) continue;
				const e = entry as Record<string, unknown>;

				const game: RommGame = {
					id: 0,
					name: '',
					platform: '',
					coverUrl: '',
					screenshotUrl: '',
					summary: '',
					releaseDate: '',
					genres: [],
					sizeBytes: 0,
				};

				if (typeof e.id === 'number') game.id = e.id;
				if (typeof e.name === 'string') game.name = e.name;

				// platform is usually { "id": ..., "name": "Nintendo 64" },
				// but be defensive in case a version flattens or omits it.
				const p = e.platform;
				if (typeof p === 'string') {
					game.platform = p;
				} else if (typeof p === 'object' && p !== null) {
					const name = (p as { name?: unknown }).name;
					if (typeof name === 'string') game.platform = name;
				}
				game.platform = game.platform.trim();

				// Cover art: prefer the 2D box, fall back to a 16:9 screenshot.
				const assets = e.assets;
				let path = assetPath(assets, 'box_2d');
				if (!path) path = assetPath(assets, 'screenshot_16x9');
				game.coverUrl = this.#absUrl(path);

				// The screenshot is what the detail screen shows; a rom
				// without one falls back to the "no screenshots" placeholder.
				game.screenshotUrl = this.#absUrl(assetPath(assets, 'screenshot_16x9'));

				game.summary = firstString(e, ['summary', 'description', 'bios']);
				game.releaseDate = parseReleaseDate(e);
				game.genres = parseGenres(e.genres);
				game.sizeBytes = firstNumber(e, ['rom_size_bytes', 'rom_size']);

				games.push(game);
			}

			return { games, error: null };
		} catch (err) {
			return { games: [], error: `cannot reach RomM (${String(err)})` };
		}
	}
}
