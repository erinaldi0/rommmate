/**
 * Disc grouping: the raw rom list the server walks into browsable titles.
 */
import type { RommGame, RommTitle } from './types';

/**
 * Group raw rom entries into titles: every disc of one release becomes a
 * single browsable game.
 *
 * The group key is the smallest disc id (unidentified roms fall back to a
 * content hash, kept negative so it can never collide with a real id).
 * Discs order by the server's `sort_comparator` when it gave one, then by
 * file name — RomM computes that key from the release structure, so it is
 * the only ordering that is right for "Disc 2" versus "disc 02" versus
 * "Part II". The title represents the user's main disc, or the first one.
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
	});

	// First-appearance order (the bucket recorded it), which keeps the
	// library in the order the server served it.
	const ordered = [...buckets.values()].sort((a, z) => a.order - z.order);

	const titles: RommTitle[] = [];
	for (const b of ordered) {
		// A disc is identified either by its own entry or by a stub left
		// behind in a sibling list; the entry wins wherever both exist.
		const keys = new Set<string>([...b.discs.keys(), ...b.sort.keys(), ...b.stubName.keys(), ...b.stubFs.keys()]);

		const discs: Array<{ key: string; game: RommGame | null; label: string; sort: string; isMain: boolean }> = [];
		for (const k of keys) {
			const game = b.discs.get(k) ?? null;
			const id = k.startsWith('s') ? 0 : Number(k);
			const label = game?.name || b.stubName.get(k) || b.stubFs.get(k) || (id > 0 ? `Game #${id}` : 'Unknown game');
			const sort = b.sort.get(k) ?? game?.fsName ?? game?.name ?? k;
			discs.push({ key: k, game, label, sort, isMain: game?.isMain === true || b.main.get(k) === true });
		}
		discs.sort((a, z) => (a.sort === z.sort ? 0 : a.sort < z.sort ? -1 : 1));

		const fullDiscs: RommGame[] = [];
		const discReleaseSlots: number[] = [];
		{
			let slot = 0;
			for (const d of discs) {
				slot += 1;
				if (d.game !== null) {
					fullDiscs.push(d.game);
					discReleaseSlots.push(slot);
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
