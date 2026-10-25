/**
 * Disc-grouping test (node): the release numbering must be identical
 * whether a walk delivered every disc of a release or only some of them
 * (a favourites or collection walk returns a subset). That takes a
 * stable tie-break (id, not insertion order) and release slots that
 * count sibling stubs.
 */
import { groupTitles } from '../src/romm/group';
import type { RommGame, RommSibling } from '../src/romm/types';

let failures = 0;
function check(name: string, ok: boolean, detail = ''): void {
	console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok || detail === '' ? '' : ` — ${detail}`}`);
	if (!ok) failures += 1;
}

let nextId = 1;
function game(id: number, gameKey: number, siblings: RommGame['siblings'], fsName: string): RommGame {
	return {
		id,
		name: 'The Legend of Dragoon',
		platformId: 13,
		platform: 'PlayStation',
		coverUrl: `cover://${id}`,
		screenshotUrl: '',
		summary: '',
		releaseDate: '',
		genres: [],
		sizeBytes: 0,
		gameKey,
		siblings,
		isMain: false,
		fsName,
		lastPlayedAt: '',
		createdAt: '',
		favorite: false,
		md5Hash: '',
		files: [],
	};
}

// Four discs, all with the same server ordering key — order must come
// from the id tiebreak. Sibling lists omit self (as RomM's do).
const IDS = [544, 546, 547, 1456];
const mkSiblings = (self: number): RommSibling[] =>
	IDS.filter((i) => i !== self).map((i) => ({
		id: i,
		sort: 'legend of dragoon',
		fsName: i === 1456 ? 'PSX.The.Legend.of.Dragoon.ITA.CD1' : 'Legend of Dragoon, The',
		name: 'The Legend of Dragoon',
		isMain: false,
	}));

// The full walk: every disc present, in id order.
const fullGames = IDS.map((id) => game(id, 544, mkSiblings(id), id === 1456 ? 'PSX...CD1' : 'Legend of Dragoon, The'));
// A partial walk (e.g. favourites): only disc id 546 arrived, but its
// sibling list describes the whole release.
const partialGames = [game(546, 544, mkSiblings(546), 'Legend of Dragoon, The')];

const fullTitles = groupTitles(fullGames);
const partialTitles = groupTitles(partialGames);

check('full: one title, four discs', fullTitles.length === 1 && fullTitles[0].discs.length === 4 && fullTitles[0].knownDiscs === 4);
check('full: slots are 1..4 in id order', JSON.stringify(fullTitles[0].discReleaseSlots) === '[1,2,3,4]', JSON.stringify(fullTitles[0].discReleaseSlots));
check('full: disc ids in order', JSON.stringify(fullTitles[0].discs.map((d) => d.id)) === '[544,546,547,1456]', JSON.stringify(fullTitles[0].discs.map((d) => d.id)));

check('partial: one title, one arrived disc', partialTitles.length === 1 && partialTitles[0].discs.length === 1);
check('partial: release knows all four', partialTitles[0].knownDiscs === 4);
check('partial: arrived disc sits at release slot 2', JSON.stringify(partialTitles[0].discReleaseSlots) === '[2]', JSON.stringify(partialTitles[0].discReleaseSlots));
check('partial: numbering agrees with the full walk', partialTitles[0].discReleaseSlots[0] === 2 && fullTitles[0].discReleaseSlots[fullTitles[0].discs.findIndex((d) => d.id === 546)] === 2);

// The reverse partial (last disc arrived) must also land at slot 4.
const partialLast = groupTitles([game(1456, 544, mkSiblings(1456), 'PSX...CD1')]);
check('partial-last: slot 4 of 4', JSON.stringify(partialLast[0].discReleaseSlots) === '[4]', JSON.stringify(partialLast[0].discReleaseSlots));

// Distinct ordering keys still win over the id tiebreak.
const sortedGames = [
	game(10, 10, [{ id: 11, sort: 'zelda disc 2', fsName: 'D2', name: 'Z', isMain: false }], 'D1'),
	game(11, 10, [{ id: 10, sort: 'zelda disc 1', fsName: 'D1', name: 'Z', isMain: false }], 'D2'),
];
const sortedTitles = groupTitles(sortedGames);
check('keys: sort_comparator orders before ids', JSON.stringify(sortedTitles[0].discs.map((d) => d.id)) === '[10,11]', JSON.stringify(sortedTitles[0].discs.map((d) => d.id)));

// Sanity: the helper used by the detail screen finds the same numbers.
for (const g of fullGames) {
	const t = fullTitles[0];
	const i = t.discs.findIndex((d) => d.id === g.id);
	const info = { index: (t.discReleaseSlots[i] ?? i + 1) - 1, count: t.knownDiscs };
	check(`map: disc ${g.id} → ${info.index + 1}/${info.count}`, IDS.indexOf(g.id) === info.index && info.count === 4);
}

console.log(failures === 0 ? '\nall grouping checks passed' : `\n${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
