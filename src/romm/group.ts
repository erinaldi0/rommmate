/**
 * Disc grouping: the raw rom list the server walks into browsable titles.
 */
import type { RommGame, RommTitle } from './types';

/**
 * The disc number a name implies, or 0 when it implies none:
 * `(Disc 2)` → 2, `CD 10` → 10, `Volume 3` → 3, `Part II`-style words
 * don't count, and `3 of 5` → 3. When several matches exist the *last*
 * wins — trailing tags are the release's disc marker, while an earlier
 * "Part 1" may be part of the title itself.
 *
 * The number is capped: a five-digit "disc" is a year or a build, not a
 * disc, and would otherwise swamp every real number in the sort.
 */
const DISC_KEYWORD = /\b(?:disc|disk|cd|cdrom|volume|vol\.?|side|part)\b[\s\-#:_\.]*([0-9]{1,4})\b/gi;
const DISC_OF = /\b([0-9]{1,4})\s+of\s+[0-9]{1,4}\b/gi;
const DISC_MAX = 1000;

export function discNumber(source: string): number {
	if (source === '') return 0;
	let n = 0;
	for (const m of source.matchAll(DISC_KEYWORD)) n = Number(m[1]);
	if (n > 0 && n < DISC_MAX) return n;
	n = 0;
	for (const m of source.matchAll(DISC_OF)) n = Number(m[1]);
	return n > 0 && n < DISC_MAX ? n : 0;
}

/**
 * Group raw rom entries into titles: every disc of one release becomes a
 * single browsable game.
 *
 * The group key is the smallest disc id (unidentified roms fall back to a
 * content hash, kept negative so it can never collide with a real id).
 * Discs order by the server's `sort_comparator` when it gave one, then by
 * file name. Beware the key: RomM derives it from the rom's *name*, and an
 * identified release hands every disc the same name — so for the common
 * multi-disc game the key ties for the whole release. The tie is broken by
 * the disc number the file name carries ("(Disc 2)" versus "(disc 02)"
 * versus "Part II"), which is the only ordering that is right; the rom id
 * is the last resort, and it is import order, not disc order. The title
 * represents the user's main disc, or the first one.
 *
 * The input may be partial (a walk still streaming): a disc whose entry has
 * not arrived yet is still shown, from its sibling stub.
 *
 * @param games the rom entries, in the order the server served them.
 * @returns one title per game, first appearance first (stable across
 *          re-runs on the same input).
 */
export function groupTitles(games: RommGame[]): RommTitle[] {
	interface Bucket {
		key: number;
		order: number;
		discs: Map<string, RommGame>;
		/** Per-disc ordering key, from every sibling list seen so far. */
		sort: Map<string, string>;
		stubName: Map<string, string>;
		stubFs: Map<string, string>;
		main: Map<string, boolean>;
	}

	const buckets = new Map<number, Bucket>();

	/** The map key for one disc of a bucket: real ids, or a slot for id-less roms. */
	const slot = (bucket: Bucket, id: number): string => (id > 0 ? `${id}` : `s${bucket.discs.size}`);

	games.forEach((g, i) => {
		let b = buckets.get(g.gameKey);
		if (b === undefined) {
			b = {
				key: g.gameKey,
				order: i,
				discs: new Map(),
				sort: new Map(),
				stubName: new Map(),
				stubFs: new Map(),
				main: new Map(),
			};
			buckets.set(g.gameKey, b);
		}

		const k = slot(b, g.id);
		b.discs.set(k, g);

		// Every sibling list seen sharpens the picture of the whole group:
		// ordering, display names and the main-disc flag.
		for (const s of g.siblings) {
			const sk = s.id > 0 ? `${s.id}` : k;
			const sort = b.sort.get(sk);
			if (s.sort !== '' && (sort === undefined || sort === '')) b.sort.set(sk, s.sort);
			if (s.name !== '' && (b.stubName.get(sk) ?? '') === '') b.stubName.set(sk, s.name);
			if (s.fsName !== '' && (b.stubFs.get(sk) ?? '') === '') b.stubFs.set(sk, s.fsName);
			if (s.isMain) b.main.set(sk, true);
		}
		if (g.isMain) b.main.set(k, true);

		// The arrived rom's own disc comparator is only ever seen in the
		// sibling lists of the *other* discs. When none has arrived yet
		// but every sibling stub shares one comparator (RomM derives it
		// from the release's name, so a release usually carries one
		// value), adopt it — otherwise the self entry falls back to its
		// file name and sorts apart from its own release, which would
		// renumber the discs differently from the full library walk.
		if (b.sort.get(k) === undefined) {
			const shared = new Set<string>();
			for (const s of g.siblings) if (s.sort !== '') shared.add(s.sort);
			if (shared.size === 1) b.sort.set(k, [...shared][0]);
		}
	});

	// First-appearance order (the bucket recorded it), which keeps the
	// library in the order the server served it.
	const ordered = [...buckets.values()].sort((a, z) => a.order - z.order);

	const titles: RommTitle[] = [];
	for (const b of ordered) {
		// A disc is identified either by its own entry or by a stub left
		// behind in a sibling list; the entry wins wherever both exist.
		const keys = new Set<string>([...b.discs.keys(), ...b.sort.keys(), ...b.stubName.keys(), ...b.stubFs.keys()]);

		interface Disc {
			key: string;
			game: RommGame | null;
			label: string;
			sort: string;
			/** The disc number the file name carries (0 = none). */
			disc: number;
			/** The most complete name known for the disc (tags included). */
			full: string;
			isMain: boolean;
		}
		const discs: Disc[] = [];
		for (const k of keys) {
			const game = b.discs.get(k) ?? null;
			const id = k.startsWith('s') ? 0 : Number(k);
			const label = game?.name || b.stubName.get(k) || b.stubFs.get(k) || (id > 0 ? `Game #${id}` : 'Unknown game');
			// `||`, not `??`: an empty name must fall through to the next
			// source, otherwise every nameless disc ties on the empty key.
			const full = game?.fsName || game?.files[0]?.fileName || game?.name || b.stubFs.get(k) || b.stubName.get(k) || '';
			const sort = b.sort.get(k) || full || k;
			discs.push({ key: k, game, label, sort, full, disc: discNumber(full), isMain: game?.isMain === true || b.main.get(k) === true });
		}
		discs.sort((a, z) => {
			if (a.sort !== z.sort) return a.sort < z.sort ? -1 : 1;
			// Equal ordering keys — which for an *identified* release happens
			// to every disc, because RomM derives the key from the rom's name
			// and the release shares one — the file name's disc number is the
			// only ordering to trust: a lower number first, and a numbered
			// disc ahead of an unnumbered one (a bonus without a number sorts
			// after the release's numbered discs, where it belongs).
			if (a.disc !== z.disc) {
				if (a.disc > 0 && z.disc > 0) return a.disc - z.disc;
				return a.disc > 0 ? -1 : 1;
			}
			// The same number (or none): the tagged name is the last string
			// that can tell the discs apart. (A lexicographic "(Disc 2)" <
			// "(Disc 10)" would misorder 10+ disc releases — the keyword
			// number above already handles those; this is the no-number case.)
			if (a.full !== z.full) return a.full < z.full ? -1 : 1;
			// Id-less roms fall back to a slot key; the id is the only
			// tiebreak that is stable across walks — insertion order differs
			// between the full library and a partial favourites/collection
			// walk, and the disc number must not depend on which walk ran.
			const ia = a.key.startsWith('s') ? Number.MAX_SAFE_INTEGER : Number(a.key);
			const iz = z.key.startsWith('s') ? Number.MAX_SAFE_INTEGER : Number(z.key);
			return ia - iz;
		});

		const fullDiscs: RommGame[] = [];
		const discReleaseSlots: number[] = [];
		{
			let slot = 0;
			for (const d of discs) {
				slot += 1;
				if (d.game !== null) {
					fullDiscs.push(d.game);
					// The disc's own number when the file name says so — a
					// partial title (a favourites walk) then names the *same*
					// disc a full walk does, instead of renumbering from its
					// position among the stubs; the position is the fallback.
					discReleaseSlots.push(d.disc > 0 ? d.disc : slot);
				}
			}
		}
		// Stubs only cannot happen for a bucket (buckets come from entries),
		// but never emit an empty title if the shape ever does.
		if (fullDiscs.length === 0) continue;

		// The disc the title represents: the main disc when the group has
		// one, else the first in disc order. The main entry may still be
		// arriving (a streaming walk), so it is only *authoritative* for the
		// name once it is here; `mainIndex` is a position in `fullDiscs`.
		const mainSlot = discs.findIndex((d) => d.isMain);
		const shown = mainSlot >= 0 ? discs[mainSlot] : discs[0];
		let mainIndex = 0;
		if (shown.game !== null) {
			const idx = fullDiscs.findIndex((g) => g.id === shown.game?.id);
			if (idx >= 0) mainIndex = idx;
		}

		const name = shown.game?.name || shown.label;
		let coverUrl = shown.game?.coverUrl ?? '';
		if (coverUrl === '') coverUrl = fullDiscs.find((g) => g.coverUrl !== '')?.coverUrl ?? '';
		let screenshotUrl = shown.game?.screenshotUrl ?? '';
		if (screenshotUrl === '') screenshotUrl = fullDiscs.find((g) => g.screenshotUrl !== '')?.screenshotUrl ?? '';

		let lastPlayedAt = '';
		let createdAt = '';
		for (const g of fullDiscs) {
			if (g.lastPlayedAt > lastPlayedAt) lastPlayedAt = g.lastPlayedAt;
			if (g.createdAt > createdAt) createdAt = g.createdAt;
		}

		titles.push({
			key: b.key,
			name,
			platformId: shown.game?.platformId ?? fullDiscs[0].platformId,
			platform: shown.game?.platform ?? fullDiscs[0].platform,
			coverUrl,
			screenshotUrl,
			discs: fullDiscs,
			knownDiscs: discs.length,
			discReleaseSlots,
			mainIndex,
			lastPlayedAt,
			createdAt,
		});
	}

	return titles;
}
