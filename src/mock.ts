/**
 * Mock library used by the "demo mode" entry on the settings screen.
 *
 * Lets the app be exercised end to end (grid navigation, scrolling, focus
 * ring, selection) without a reachable RomM server or valid credentials.
 * The shape matches `RommGame` exactly, so the library screen cannot tell
 * the difference.
 */
import type { RommGame } from './romm';

interface MockEntry {
	name: string;
	platform: string;
}

const ENTRIES: MockEntry[] = [
	{ name: 'Super Mario 64', platform: 'Nintendo 64' },
	{ name: 'The Legend of Zelda: Ocarina of Time', platform: 'Nintendo 64' },
	{ name: 'Metroid Prime', platform: 'GameCube' },
	{ name: 'Perfect Dark', platform: 'Nintendo 64' },
	{ name: 'Banjo-Kazooie', platform: 'Nintendo 64' },
	{ name: 'GoldenEye 007', platform: 'Nintendo 64' },
	{ name: 'Donkey Kong Country', platform: 'SNES' },
	{ name: 'Star Fox 64', platform: 'Nintendo 64' },
	{ name: 'Paper Mario', platform: 'Nintendo 64' },
	{ name: 'Mario Kart 64', platform: 'Nintendo 64' },
	{ name: 'F-Zero X', platform: 'Nintendo 64' },
	{ name: 'Wave Race 64', platform: 'Nintendo 64' },
	{ name: 'Sin & Punishment', platform: 'Nintendo 64' },
	{ name: 'Jet Set Radio', platform: 'GameCube' },
	{ name: 'Conker: Live & Reloaded', platform: 'GameCube' },
	{ name: 'Kameo: Elements of Power', platform: 'GameCube' },
	{ name: 'The Legend of Zelda: A Link to the Past', platform: 'SNES' },
	{ name: 'Super Metroid', platform: 'SNES' },
	{ name: 'EarthBound', platform: 'SNES' },
	{ name: 'Chrono Trigger', platform: 'SNES' },
	{ name: 'Final Fantasy VI', platform: 'SNES' },
	{ name: 'Super Mario World', platform: 'SNES' },
	{ name: 'Kirby Super Star', platform: 'SNES' },
	{ name: 'Mega Man X', platform: 'SNES' },
	{ name: 'Castlevania: Symphony of the Night', platform: 'PlayStation' },
	{ name: 'Final Fantasy VII', platform: 'PlayStation' },
	{ name: 'Metal Gear Solid', platform: 'PlayStation' },
	{ name: 'Crash Bandicoot', platform: 'PlayStation' },
	{ name: 'Gran Turismo', platform: 'PlayStation' },
	{ name: 'Spyro the Dragon', platform: 'PlayStation' },
	{ name: 'Super Metroid X', platform: 'SNES' },
	{ name: 'The Legend of Zelda: Link\'s Awakening', platform: 'Game Boy' },
	{ name: 'Tetris', platform: 'Game Boy' },
	{ name: 'Pokemon Red', platform: 'Game Boy' },
	{ name: 'Mega Man IV', platform: 'Game Boy' },
	{ name: 'Super Mario Land 2', platform: 'Game Boy' },
	{ name: 'Metroid Fusion', platform: 'Game Boy Advance' },
	{ name: 'The Legend of Zelda: The Minish Cap', platform: 'Game Boy Advance' },
	{ name: 'Advance Wars', platform: 'Game Boy Advance' },
	{ name: 'Mario Kart: Super Circuit', platform: 'Game Boy Advance' },
	{ name: 'Golden Sun', platform: 'Game Boy Advance' },
	{ name: 'Sonic the Hedgehog 2', platform: 'Genesis' },
	{ name: 'Streets of Rage 2', platform: 'Genesis' },
	{ name: 'Gunstar Heroes', platform: 'Genesis' },
	{ name: 'Castlevania: Bloodlines', platform: 'Genesis' },
	{ name: 'Chrono Trigger', platform: 'SNES' },
	{ name: 'Super Mario RPG', platform: 'SNES' },
	{ name: 'Sonic Mania', platform: 'Arcade' },
	{ name: 'Street Fighter II', platform: 'Arcade' },
	{ name: 'Donkey Kong Country 2', platform: 'SNES' },
	{ name: 'Pilotwings 64', platform: 'Nintendo 64' },
	{ name: 'Bomberman Hero', platform: 'Nintendo 64' },
	{ name: 'Hybrid Heaven', platform: 'Nintendo 64' },
	{ name: 'Rocket: Robot on Wheels', platform: 'Nintendo 64' },
];

/**
 * The mock library. `coverUrl` is empty on purpose: remote artwork would
 * need a live RomM server, and the grid draws a placeholder tile instead.
 */
export const MOCK_GAMES: RommGame[] = ENTRIES.map((entry, i) => ({
	id: i + 1,
	name: entry.name,
	platform: entry.platform,
	coverUrl: '',
}));
