/**
 * Mock library used by the "demo mode" entry on the settings screen.
 *
 * Lets the app be exercised end to end (grid navigation, scrolling, focus
 * ring, filtering, selection, detail screen) without a reachable RomM
 * server or valid credentials. The shape matches `RommGame` exactly, so
 * the library screen cannot tell the difference.
 */
import type { RommCollection, RommGame, RommSibling } from './romm';

interface MockEntry {
	name: string;
	platform: string;
	/** Short blurb for the detail screen. */
	summary: string;
	/** Release date, `YYYY-MM-DD`. */
	releaseDate: string;
	genres: string[];
	/** Rom size in bytes (roughly plausible for the era). */
	sizeBytes: number;
}

const ENTRIES: MockEntry[] = [
	{
		name: 'Super Mario 64',
		platform: 'Nintendo 64',
		summary:
			'Mario is back in a fully three-dimensional Mushroom Kingdom. Collect stars, race friends, and stomp your way through a castle that remembers every room you have not yet solved.',
		releaseDate: '1996-06-23',
		genres: ['Platform', 'Adventure'],
		sizeBytes: 12_582_912,
	},
	{
		name: 'The Legend of Zelda: Ocarina of Time',
		platform: 'Nintendo 64',
		summary:
			'Link draws the Master Sword and plunges into Hyrule, where a failed time-travel experiment has turned the Kokiri Forest into a monster-infested ruin.',
		releaseDate: '1998-11-21',
		genres: ['Action', 'Adventure', 'RPG'],
		sizeBytes: 12_582_912,
	},
	{
		name: 'Metroid Prime',
		platform: 'GameCube',
		summary:
			'A first-person adventure as Samus Aran, investigating a derelict Chozo research facility on the planet Tallon and everything the federation left behind.',
		releaseDate: '2002-11-17',
		genres: ['Action', 'Adventure'],
		sizeBytes: 32_244_352,
	},
	{
		name: 'Perfect Dark',
		platform: 'Nintendo 64',
		summary:
			'Agent Joanna Dark infiltrates a dataDyne corporate complex in 2027, and the story branches in dozens of ways depending on how much of the building she has already seen.',
		releaseDate: '2000-05-22',
		genres: ['Action', 'Shooter'],
		sizeBytes: 12_582_912,
	},
	{
		name: 'Banjo-Kazooie',
		platform: 'Nintendo 64',
		summary:
			'A bear and a bird attempt to undo a witch\'s transformation, collecting puzzle pieces, notes and honeycomb across a sprawling overworld of hub areas.',
		releaseDate: '1998-06-29',
		genres: ['Platform', 'Adventure'],
		sizeBytes: 8_912_896,
	},
	{
		name: 'GoldenEye 007',
		platform: 'Nintendo 64',
		summary:
			'James Bond gets a licence to kill in a mission-based adaptation of the GoldenEye films, with a timed multiplayer mode that defined an entire generation.',
		releaseDate: '1997-08-25',
		genres: ['Shooter', 'Action'],
		sizeBytes: 11_534_336,
	},
	{
		name: 'Donkey Kong Country',
		platform: 'SNES',
		summary:
			'Donkey Kong and Diddy Kong race through Donkey Kong Country to recover the stolen hoard and rescue their kidnapped relatives.',
		releaseDate: '1994-11-21',
		genres: ['Platform'],
		sizeBytes: 2_097_152,
	},
	{
		name: 'Star Fox 64',
		platform: 'Nintendo 64',
		summary:
			'Fox McCloud leads the Star Fox team across the Lylat system, piloting Arwings, Landmasters and the blue-speed vehicle the Corneria engineers built for him.',
		releaseDate: '1997-04-27',
		genres: ['Shooter', 'Action'],
		sizeBytes: 12_582_912,
	},
	{
		name: 'Paper Mario',
		platform: 'Nintendo 64',
		summary:
			'Mario\'s adventure told on paper, with a battle system that rewards timing your attacks and watching your partner fold out of the way.',
		releaseDate: '2000-08-11',
		genres: ['RPG'],
		sizeBytes: 12_582_912,
	},
	{
		name: 'Mario Kart 64',
		platform: 'Nintendo 64',
		summary:
			'Four players, four tracks per cup and a single-item race that has been the benchmark for kart games ever since.',
		releaseDate: '1996-12-14',
		genres: ['Racing'],
		sizeBytes: 12_582_912,
	},
	{
		name: 'F-Zero X',
		platform: 'Nintendo 64',
		summary:
			'Captain Falcon and the F-Zero machine race across the Solar System at speeds that turn the track into a blur of light.',
		releaseDate: '1998-07-14',
		genres: ['Racing'],
		sizeBytes: 8_912_896,
	},
	{
		name: 'Wave Race 64',
		platform: 'Nintendo 64',
		summary:
			'Racing on water at 200 miles an hour, with a single-player mode that turns every course into a time trial against a rival ghost.',
		releaseDate: '1996-09-27',
		genres: ['Racing', 'Sports'],
		sizeBytes: 12_582_912,
	},
	{
		name: 'Sin & Punishment',
		platform: 'Nintendo 64',
		summary:
			'A run-and-gun rail shooter set in a world of biological machinery, later released in the West as Deadly Sin and Punishment.',
		releaseDate: '2000-11-21',
		genres: ['Shooter', 'Action'],
		sizeBytes: 12_582_912,
	},
	{
		name: 'Jet Set Radio',
		platform: 'GameCube',
		summary:
			'Turbo gangs on rollerblades carve up Shibuya with graffiti cans, spraying tags to open paths and chasing the rival crews who would rather crush them.',
		releaseDate: '2002-06-28',
		genres: ['Action', 'Sports'],
		sizeBytes: 32_244_352,
	},
	{
		name: 'Conker: Live & Reloaded',
		platform: 'GameCube',
		summary:
			'A sharper, meaner remake of the Rare classic, with an inventive multiplayer mode built around a hunting-and-gathering minigame.',
		releaseDate: '2003-03-21',
		genres: ['Platform', 'Action'],
		sizeBytes: 32_244_352,
	},
	{
		name: 'Kameo: Elements of Power',
		platform: 'GameCube',
		summary:
			'A small dinosaur is turned into a warrior by a shaman, and the pair fight their way up a mountain to undo the transformation.',
		releaseDate: '2004-12-17',
		genres: ['Action', 'Adventure'],
		sizeBytes: 32_244_352,
	},
	{
		name: 'The Legend of Zelda: A Link to the Past',
		platform: 'SNES',
		summary:
			'Link travels to a past version of Hyrule and must prevent the Dark World from swallowing the Light, with seven maiden crystals and a Master Sword to find.',
		releaseDate: '1991-11-21',
		genres: ['Action', 'Adventure', 'RPG'],
		sizeBytes: 2_097_152,
	},
	{
		name: 'Super Metroid',
		platform: 'SNES',
		summary:
			'Samus Aran explores the planet Zebes, and the game is famously silent until she reaches the last boss and the soundtrack finds its voice.',
		releaseDate: '1994-03-19',
		genres: ['Action', 'Adventure'],
		sizeBytes: 2_097_152,
	},
	{
		name: 'EarthBound',
		platform: 'SNES',
		summary:
			'Ness and Paula travel from a peaceful suburb to an urban dystopia in a modern, mundane world where psychic powers turn children into weapons.',
		releaseDate: '1994-06-05',
		genres: ['RPG'],
		sizeBytes: 2_097_152,
	},
	{
		name: 'Chrono Trigger',
		platform: 'SNES',
		summary:
			'Time travel across seven eras to stop Lavos, with a battle system that mixes techniques from every era the party has visited.',
		releaseDate: '1995-03-11',
		genres: ['RPG'],
		sizeBytes: 2_097_152,
	},
	{
		name: 'Final Fantasy VI',
		platform: 'SNES',
		summary:
			'Fourteen characters, one ruined world and a final battle against a forgotten goddess who has decided to end magic for good.',
		releaseDate: '1994-04-02',
		genres: ['RPG'],
		sizeBytes: 2_097_152,
	},
	{
		name: 'Super Mario World',
		platform: 'SNES',
		summary:
			'Mario\'s biggest adventure yet: a wide overworld, a hundred and one levels, and Yoshi who can eat almost anything.',
		releaseDate: '1990-11-21',
		genres: ['Platform'],
		sizeBytes: 2_097_152,
	},
	{
		name: 'Kirby Super Star',
		platform: 'SNES',
		summary:
			'Kirby swallows his enemies and copies their powers across a dozen short, densely designed stages.',
		releaseDate: '1996-03-21',
		genres: ['Platform'],
		sizeBytes: 1_048_576,
	},
	{
		name: 'Mega Man X',
		platform: 'SNES',
		summary:
			'Zero has vanished, Maverick keeps rebuilding itself, and the blue bomber has to fight his way to the top of a tower with only his buster and a single armour upgrade.',
		releaseDate: '1993-12-17',
		genres: ['Action', 'Platform'],
		sizeBytes: 1_048_576,
	},
	{
		name: 'Castlevania: Symphony of the Night',
		platform: 'PlayStation',
		summary:
			'Alucard\'s castle is explored in any order the player likes, and the best run in the series was shaped entirely by which rooms happened to be reachable.',
		releaseDate: '1997-03-20',
		genres: ['Action', 'Adventure', 'RPG'],
		sizeBytes: 30_408_704,
	},
	{
		name: 'Final Fantasy VII',
		platform: 'PlayStation',
		summary:
			'Cloud\'s party fights a corporate power in the ruins of Midgar, and the game that changed the industry forever still holds up.',
		releaseDate: '1997-01-31',
		genres: ['RPG'],
		sizeBytes: 48_234_496,
	},
	{
		name: 'Metal Gear Solid',
		platform: 'PlayStation',
		summary:
			'Solid Snake is dropped behind enemy lines, and the game rewards players who watch the briefings and remember the details.',
		releaseDate: '1998-09-03',
		genres: ['Action', 'Stealth'],
		sizeBytes: 40_632_320,
	},
	{
		name: 'Crash Bandicoot',
		platform: 'PlayStation',
		summary:
			'A marsupial with no legs runs, jumps and spins his way through Wumpa Island, and the time trial is still a rite of passage.',
		releaseDate: '1996-09-09',
		genres: ['Platform'],
		sizeBytes: 20_971_520,
	},
	{
		name: 'Gran Turismo',
		platform: 'PlayStation',
		summary:
			'Sim racing with a career mode that spans a decade of motorsport, and a licensed soundtrack that made the console worth buying.',
		releaseDate: '1997-12-04',
		genres: ['Racing', 'Sim'],
		sizeBytes: 41_943_040,
	},
	{
		name: 'Spyro the Dragon',
		platform: 'PlayStation',
		summary:
			'A small purple dragon collects dragon gems and rescues dragon elders, with a dragon riding system that turns every level into an aerial playground.',
		releaseDate: '1998-09-09',
		genres: ['Platform'],
		sizeBytes: 20_971_520,
	},
	{
		name: 'Super Metroid X',
		platform: 'SNES',
		summary:
			'Not an official Metroid, but the fan-made tribute that proved the series could be reimagined rather than remade.',
		releaseDate: '1994-08-31',
		genres: ['Action', 'Platform'],
		sizeBytes: 1_048_576,
	},
	{
		name: "The Legend of Zelda: Link's Awakening",
		platform: 'Game Boy',
		summary:
			'Link wakes up on an island of his own making and has to work out how to escape it, sword and all.',
		releaseDate: '1993-06-06',
		genres: ['Action', 'Adventure', 'RPG'],
		sizeBytes: 1_048_576,
	},
	{
		name: 'Tetris',
		platform: 'Game Boy',
		summary:
			'Four blocks, ten lines, endless pressure. The Game Boy version added a handful of modes and kept the original intact.',
		releaseDate: '1989-06-14',
		genres: ['Puzzle'],
		sizeBytes: 32_768,
	},
	{
		name: 'Pokemon Red',
		platform: 'Game Boy',
		summary:
			'A starter creature, a rival, and eight badges — the game that turned a handheld into a social object.',
		releaseDate: '1996-02-27',
		genres: ['RPG'],
		sizeBytes: 1_048_576,
	},
	{
		name: 'Mega Man IV',
		platform: 'Game Boy',
		summary:
			'The first Mega Man on a handheld, with a stiff palette and a difficulty curve that dips in the middle.',
		releaseDate: '1991-12-28',
		genres: ['Action', 'Platform'],
		sizeBytes: 524_288,
	},
	{
		name: 'Super Mario Land 2: 6 Coins',
		platform: 'Game Boy',
		summary:
			'Mario returns to a transformed Mushroom Kingdom, split into two halves that meet in the middle.',
		releaseDate: '1992-10-21',
		genres: ['Platform'],
		sizeBytes: 1_048_576,
	},
	{
		name: 'Metroid Fusion',
		platform: 'Game Boy Advance',
		summary:
			'The X-parasite fuses with Samus and the atmosphere closes in: the tightest Metroid ever made.',
		releaseDate: '2002-11-04',
		genres: ['Action', 'Adventure'],
		sizeBytes: 3_145_728,
	},
	{
		name: 'The Legend of Zelda: The Minish Cap',
		platform: 'Game Boy Advance',
		summary:
			'Link is shrunk to miniature size and borrows a sword from a friendly blade, with a village festival at the heart of the story.',
		releaseDate: '2004-12-03',
		genres: ['Action', 'Adventure', 'RPG'],
		sizeBytes: 3_145_728,
	},
	{
		name: 'Advance Wars',
		platform: 'Game Boy Advance',
		summary:
			'Tactical warfare on a small screen, complete with weather, day/night cycles and units that lose their morale when they are losing.',
		releaseDate: '2001-09-10',
		genres: ['Strategy'],
		sizeBytes: 2_097_152,
	},
	{
		name: 'Mario Kart: Super Circuit',
		platform: 'Game Boy Advance',
		summary:
			'A handheld Mario Kart with four tracks of its own and a single-player time trial that is still hard to put down.',
		releaseDate: '2001-08-27',
		genres: ['Racing'],
		sizeBytes: 2_097_152,
	},
	{
		name: 'Golden Sun',
		platform: 'Game Boy Advance',
		summary:
			'Djinn are summoned from the ground, psynergies replace magic, and the GBA gets one of its finest role-playing games.',
		releaseDate: '2001-11-25',
		genres: ['RPG'],
		sizeBytes: 3_145_728,
	},
	{
		name: 'Sonic the Hedgehog 2',
		platform: 'Genesis',
		summary:
			'Sonic and Tails rescue the Chaos Emeralds while Dr. Eggman builds a death egg, and the chemical plant level becomes the high-water mark of the series.',
		releaseDate: '1992-11-21',
		genres: ['Platform'],
		sizeBytes: 2_097_152,
	},
	{
		name: 'Streets of Rage 2',
		platform: 'Genesis',
		summary:
			'Blaze gets a barbell and a grudge, and the streets of Woodcrest City fill with thugs who all drop the same bottles.',
		releaseDate: '1993-01-14',
		genres: ['Beat ’em up', 'Action'],
		sizeBytes: 2_097_152,
	},
	{
		name: 'Gunstar Heroes',
		platform: 'Genesis',
		summary:
			'Two commandos with an absurd arsenal rescue a hostage from an evil empire, and the game knows exactly how funny it is.',
		releaseDate: '1993-09-09',
		genres: ['Run and gun', 'Action'],
		sizeBytes: 1_048_576,
	},
	{
		name: 'Castlevania: Bloodlines',
		platform: 'Genesis',
		summary:
			'Two Belmonts, two continents and a pair of halves that make the game famous for its difficulty and its audio.',
		releaseDate: '1994-03-17',
		genres: ['Action', 'Platform'],
		sizeBytes: 2_097_152,
	},
	{
		name: 'Chrono Trigger',
		platform: 'SNES',
		summary:
			'The time-travel adventure again, this time with a second New Game Plus and a pet-raising side quest.',
		releaseDate: '1995-03-11',
		genres: ['RPG'],
		sizeBytes: 2_097_152,
	},
	{
		name: 'Super Mario RPG',
		platform: 'SNES',
		summary:
			'Mario meets the RPG treatment: a world map, a job system and timed action commands in every fight.',
		releaseDate: '1996-03-09',
		genres: ['RPG'],
		sizeBytes: 3_145_728,
	},
	{
		name: 'Sonic Mania',
		platform: 'Arcade',
		summary:
			'The new zones sit beside the classics, and the physics finally feel like the fans always remembered them.',
		releaseDate: '2017-08-15',
		genres: ['Platform'],
		sizeBytes: 31_457_280,
	},
	{
		name: 'Street Fighter II',
		platform: 'Arcade',
		summary:
			'The fighting game that rewrote the genre, with a cast of eleven and a combo system nobody had seen before.',
		releaseDate: '1991-02-06',
		genres: ['Fighting'],
		sizeBytes: 2_097_152,
	},
	{
		name: 'Donkey Kong Country 2',
		platform: 'SNES',
		summary:
			'Diddy and Dixie Kong crash the enemy\'s ship and steal their bananas, all to a level soundtrack that has never been topped.',
		releaseDate: '1995-11-20',
		genres: ['Platform'],
		sizeBytes: 2_097_152,
	},
	{
		name: 'Pilotwings 64',
		platform: 'Nintendo 64',
		summary:
			'Fly small planes, earn a licence and build an airport. A gentle, unhurried game about the pleasure of taking off.',
		releaseDate: '1996-12-17',
		genres: ['Simulation'],
		sizeBytes: 8_912_896,
	},
	{
		name: 'Bomberman Hero',
		platform: 'Nintendo 64',
		summary:
			'The series drops the isometric mazes for a platforming adventure, and it works better than it has any right to.',
		releaseDate: '1998-01-21',
		genres: ['Action', 'Platform'],
		sizeBytes: 12_582_912,
	},
	{
		name: 'Hybrid Heaven',
		platform: 'Nintendo 64',
		summary:
			'Strategy and action fused into a story about three friends on a planet where the weather decides everything.',
		releaseDate: '1999-02-25',
		genres: ['Strategy', 'RPG'],
		sizeBytes: 12_582_912,
	},
	{
		name: 'Rocket: Robot on Wheels',
		platform: 'Nintendo 64',
		summary:
			'A robot, a bunch of floating platforms and a very small button repertoire — the purest platformer of the year.',
		releaseDate: '1998-08-28',
		genres: ['Platform'],
		sizeBytes: 8_912_896,
	},
];

/** One disc of a release, for the mock's multi-disc games. */
function sib(id: number, sort: string, fsName: string, name: string, isMain: boolean): RommSibling {
	return { id, sort, fsName, name, isMain };
}

/** An ISO timestamp `ms` milliseconds ago. */
function ago(ms: number): string {
	return new Date(Date.now() - ms).toISOString();
}

const HOUR = 3_600_000;
const DAY = 86_400_000;

/**
 * The mock library. `coverUrl` is empty on purpose: remote artwork would
 * need a live RomM server, and the tiles draw a placeholder instead.
 *
 * The library also carries the richer state the dashboard browses by:
 * play times (every 9th game a few hours ago, every 13th a few days ago),
 * favourites (every 7th), staggered addition dates, and two multi-disc
 * releases (the two Chrono Trigger copies, and Final Fantasy VI + disc 2).
 */
export const MOCK_GAMES: RommGame[] = ENTRIES.map((entry, i) => {
	const id = i + 1;
	const fsName = `${entry.name}.zip`;
	return {
		id,
		name: entry.name,
		platform: entry.platform,
		coverUrl: '',
		screenshotUrl: '',
		summary: entry.summary,
		releaseDate: entry.releaseDate,
		genres: entry.genres,
		sizeBytes: entry.sizeBytes,
		gameKey: id,
		siblings: [sib(id, '', fsName, entry.name, true)],
		isMain: true,
		fsName,
		lastPlayedAt: id % 9 === 0 ? ago((id % 5 + 1) * HOUR) : id % 13 === 0 ? ago((id % 7 + 1) * DAY) : '',
		createdAt: ago(id * DAY),
		favorite: id % 7 === 0,
	};
});

// ── multi-disc releases ────────────────────────────────────────────────────

// The two Chrono Trigger copies are one release with two discs.
const chronos = MOCK_GAMES.filter((g) => g.name === 'Chrono Trigger');
const chronoA = chronos[0];
const chronoB = chronos[1];
if (chronoA !== undefined && chronoB !== undefined) {
	const group = [
		sib(chronoA.id, 'Disc 1', chronoA.fsName, 'Chrono Trigger', true),
		sib(chronoB.id, 'Disc 2', chronoB.fsName, 'Chrono Trigger', false),
	];
	chronoA.gameKey = Math.min(chronoA.id, chronoB.id);
	chronoA.siblings = group;
	chronoB.gameKey = chronoA.gameKey;
	chronoB.siblings = group;
}

// Final Fantasy VI gets a second disc.
const ffvi = MOCK_GAMES.find((g) => g.name === 'Final Fantasy VI');
if (ffvi !== undefined) {
	const disc2Id = ENTRIES.length + 1;
	const disc2: RommGame = {
		id: disc2Id,
		name: ffvi.name,
		platform: ffvi.platform,
		coverUrl: '',
		screenshotUrl: '',
		summary: ffvi.summary,
		releaseDate: ffvi.releaseDate,
		genres: ffvi.genres,
		sizeBytes: ffvi.sizeBytes,
		gameKey: ffvi.id,
		siblings: [
			sib(ffvi.id, 'Disc 1', `${ffvi.name} (Disc 1).zip`, ffvi.name, true),
			sib(disc2Id, 'Disc 2', `${ffvi.name} (Disc 2).zip`, ffvi.name, false),
		],
		isMain: false,
		fsName: `${ffvi.name} (Disc 2).zip`,
		lastPlayedAt: '',
		createdAt: ago(disc2Id * DAY),
		favorite: false,
	};
	ffvi.fsName = `${ffvi.name} (Disc 1).zip`;
	ffvi.siblings = disc2.siblings;
	MOCK_GAMES.push(disc2);
}

/** Mock saved collections for the dashboard's last row. */
export const MOCK_COLLECTIONS: RommCollection[] = [
	{ id: 1, name: 'Night games', romCount: 12, coverUrl: '', kind: 'user' },
	{ id: 2, name: 'RPGs', romCount: 34, coverUrl: '', kind: 'user' },
	{ id: 3, name: 'Recently played', romCount: 8, coverUrl: '', kind: 'smart' },
];
