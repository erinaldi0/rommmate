/**
 * The platform → libretro core map.
 *
 * The official RetroArch release ships every core in a single 290 MB 7z,
 * but per-core downloads are preferable: for most platforms the app pulls
 * *individual* core zips straight off libretro's buildbot (the nightly
 * `latest/` directory, see `bb` below), keeping only the loader need the
 * full package. Cores the buildbot does not publish come from the
 * tooling-platform uploads on the server.
 *
 * Downloads come, when possible, straight from libretro's buildbot (the
 * per-core zips the Switch core updater itself pulls — see `bb` below); a
 * core the buildbot does not publish falls back to the tooling-platform
 * uploads on the server.
 *
 * The match is deliberately loose: a case-insensitive substring of the
 * core's base name, tested against the *server file name* of whatever sits
 * in the RetroArch platform. The user can upload the bare
 * `mgba_libretro_libnx.nro` from the unpacked release, a buildbot core
 * zip, or a renamed file — as long as the name contains the core's
 * identity the app finds it. Where a platform has several good cores, the
 * first entry is the recommendation and the rest are picker options.
 */
import { platformSlug } from './layout';

/** One usable core for a platform. */
export interface CoreChoice {
	/** Stable id (persisted in the config's per-platform choice). */
	id: string;
	/** Display label for the picker. */
	label: string;
	/**
	 * Tested (case-insensitively) against the server file name to decide
	 * whether an uploaded file *is* this core.
	 */
	match: RegExp;
	/**
	 * The core's base name on libretro's buildbot, when it is published
	 * there (`mupen64plus_next_libretro_libnx.nro.zip` →
	 * `mupen64plus_next`). Direct downloads are keyed off it; undefined
	 * means the buildbot does not have this core under this name and the
	 * server fallback is the only source.
	 */
	bb?: string;
}

/** One emulable platform and the cores that run it. */
export interface CoreMapEntry {
	/** The platform slugs (see `platformSlug`) this entry covers. */
	aliases: string[];
	/** The platform's own display name (labels). */
	display: string;
	/** Usable cores, best first. */
	choices: CoreChoice[];
	/**
	 * The BIOS file names this platform's cores look for in the system
	 * directory (informational — the BIOS flow downloads whatever firmware
	 * the server has for the platform, this names what is *expected*).
	 */
	bios: string[];
}

const C = (id: string, label: string, match: RegExp, bb?: string): CoreChoice => ({
	id,
	label,
	match,
	bb,
});

/**
 * The map. `aliases` are `platformSlug` forms, so "Game Boy", "GAME BOY"
 * and "game-boy" all land on the same entry.
 */
export const CORE_MAP: CoreMapEntry[] = [
	{
		aliases: ['nes', 'nintendoentertainsystem', 'famicom'],
		display: 'NES',
		choices: [
			C('fceumm', 'FCEUmm', /fceumm/i, 'fceumm'),
			C('quicknes', 'QuickNES', /quicknes/i, 'quicknes'),
			C('nestopia', 'Nestopia UE', /nestopia/i, 'nestopia'),
			C('mesenes', 'MESEN (NES)', /mesenes/i, 'mesen'),
		],
		bios: [],
	},
	{
		aliases: ['snes', 'supernintendoentertainsystem', 'superfamicom'],
		display: 'SNES',
		choices: [
			// The 2010 fork is the best-maintained; it must be listed
			// before plain snes9x (a 2010 file also matches /snes9x/).
			C('snes9x2010', 'Snes9x 2010', /snes9x2010|snes9x_2010/i, 'snes9x2010'),
			C('snes9x', 'Snes9x', /snes9x/i, 'snes9x'),
			C('bsnes', 'bsnes HD Beta', /bsnes/i, 'bsnes_hd_beta'),
			C('mesesnes', 'MESEN (SNES)', /mesesnes/i, 'mesen-s'),
		],
		bios: [],
	},
	{
		aliases: ['gb', 'gameboy'],
		display: 'Game Boy',
		choices: [
			C('gambatte', 'Gambatte', /gambatte/i, 'gambatte'),
			C('tgb', 'TGCDual', /tgb/i, 'tgbdual'),
			C('gearboy', 'Gearboy', /gearboy/i, 'gearboy'),
			C('smootherplus', 'SmootherPlus', /smoother/i),
			C('sameboy', 'SameBoy', /sameboy/i, 'sameboy'),
		],
		bios: [],
	},
	{
		aliases: ['gbc', 'gameboycolor'],
		display: 'Game Boy Color',
		choices: [
			C('gambatte', 'Gambatte', /gambatte/i, 'gambatte'),
			C('tgb', 'TGCDual', /tgb/i, 'tgbdual'),
			C('gearboy', 'Gearboy', /gearboy/i, 'gearboy'),
			C('smootherplus', 'SmootherPlus', /smoother/i),
		],
		bios: [],
	},
	{
		aliases: ['gba', 'gameboyanvance'],
		display: 'Game Boy Advance',
		choices: [
			C('mgba', 'mGBA', /mgba/i, 'mgba'),
			C('vbanext', 'VBA-Next', /vba_next|vbanext/i, 'vba_next'),
			C('gambatte', 'Gambatte', /gambatte/i, 'gambatte'),
		],
		bios: [],
	},
	{
		aliases: ['n64', 'nintendo64'],
		display: 'Nintendo 64',
		choices: [
			C('mupen64plusnext', 'Mupen64Plus Next', /mupen64plus_next|mupen64plusnext/i, 'mupen64plus_next'),
			C('mupen64plus', 'Mupen64Plus', /mupen64plus/i),
			C('project64', 'Project64', /project64/i),
		],
		bios: [],
	},
	{
		aliases: ['nds', 'nintendods'],
		display: 'Nintendo DS',
		choices: [
			C('desmume', 'DeSmuME', /desmume/i, 'desmume'),
			C('melonds', 'melonDS', /melonds/i, 'melonds'),
		],
		bios: [],
	},
	{
		aliases: ['ps1', 'playstation', 'playstationconsole', 'psx', 'sonyplaystation'],
		display: 'PlayStation',
		choices: [
			C('pcsxrearmed', 'PCSX ReARMed', /pcsx_rearmed|pcsxrearmed/i, 'pcsx_rearmed'),
			C('beetlepsx', 'Beetle PSX', /beetle_psx|beetlepsx/i),
		],
		// The US 1.0 / US 3.9 / Japan bios — the core boots on any one of them.
		bios: ['scph1001.bin', 'scph5501.bin', 'scph150.bin'],
	},
	{
		aliases: ['psp', 'playstationportable', 'pspgo', 'psplit'],
		display: 'PlayStation Portable',
		choices: [C('ppsspp', 'PPSSPP', /ppsspp/i, 'ppsspp')],
		// PS1 games inside PPSSPP want the PS1 bios too.
		bios: ['scph5501.bin'],
	},
	{
		aliases: ['dos', 'pcdos'],
		display: 'DOS',
		choices: [
			C('dosboxsvn', 'DOSBox SVN', /dosbox_svn|dosboxsvn/i, 'dosbox_svn'),
			C('dosboxpure', 'DOSBox Pure', /dosbox_pure|dosboxpure/i, 'dosbox_pure'),
			C('dosbox', 'DOSBox', /dosbox/i),
		],
		bios: [],
	},
	{
		aliases: ['arcade', 'arcadegames', 'mame'],
		display: 'Arcade',
		choices: [
			C('fbneo', 'FBNeo', /fbneo/i, 'fbneo'),
			C('mame2003plus', 'MAME 2003 Plus', /mame2003/i, 'mame2003_plus'),
			C('mame', 'MAME', /mame/),
		],
		bios: [],
	},
	{
		aliases: ['genesis', 'megadrive', 'segagenesis', 'segamegadrive', 'segagenesismegadrive'],
		display: 'Sega Genesis / Mega Drive',
		choices: [
			C('genesisplusgx', 'Genesis Plus GX', /genesis_plus_gx|genesisplusgx/i, 'genesis_plus_gx'),
			C('picodrive', 'PicoDrive', /picodrive/i, 'picodrive'),
			C('gearsystem', 'GearSystem', /gearsystem/i, 'gearsystem'),
		],
		bios: [],
	},
	{
		aliases: ['sms', 'mastersystem', 'mastersystemjr', 'segamastersystem'],
		display: 'Sega Master System',
		choices: [
			C('genesisplusgx', 'Genesis Plus GX', /genesis_plus_gx|genesisplusgx/i, 'genesis_plus_gx'),
			C('picodrive', 'PicoDrive', /picodrive/i, 'picodrive'),
		],
		bios: [],
	},
	{
		aliases: ['saturn', 'segasaturn'],
		display: 'Sega Saturn',
		choices: [C('yabansh', 'Yabansh', /yabansh/i)],
		bios: [],
	},
	{
		aliases: ['2600', 'atari2600', 'atari2600jr'],
		display: 'Atari 2600',
		choices: [C('starglider', 'Starglider', /starglider/i)],
		bios: [],
	},
	{
		aliases: ['7800', 'atari7800'],
		display: 'Atari 7800',
		choices: [C('prosystem', 'ProSystem', /prosystem/i, 'prosystem')],
		bios: [],
	},
	{
		aliases: ['c64', 'commodore64', 'vic20', 'commodore'],
		display: 'Commodore 64',
		choices: [C('vic20', 'VIC-20 / C64', /vic20/i)],
		bios: [],
	},
];

const BY_SLUG = new Map<string, CoreMapEntry>();
for (const entry of CORE_MAP) {
	for (const alias of entry.aliases) {
		// First registration wins, so the most specific slug is kept.
		if (!BY_SLUG.has(alias)) BY_SLUG.set(alias, entry);
	}
}

/** The map entry for a RomM platform name, or null when it is not emulable. */
export function coreEntryFor(platformName: string): CoreMapEntry | null {
	return BY_SLUG.get(platformSlug(platformName)) ?? null;
}

/** True when the platform has at least one core the app knows how to run. */
export function isEmulablePlatform(platformName: string): boolean {
	return coreEntryFor(platformName) !== null;
}

/** The user's choice (config override) for a platform, else the recommendation. */
export function chosenChoice(
	entry: CoreMapEntry,
	choices: Record<string, string>,
): CoreChoice {
	const picked = choices[platformSlug(entry.display)];
	return entry.choices.find((c) => c.id === picked) ?? entry.choices[0];
}

/** Does this server file name look like the given core? */
export function choiceMatches(choice: CoreChoice, fileName: string): boolean {
	return choice.match.test(fileName);
}

/**
 * Fork / rename normalisation to the name RomM's own emulator list uses,
 * so a save keeps pairing with what the stand-alone emulator recorded.
 */
const EMULATOR_NAMES: Record<string, string> = {
	snes9x_2010: 'snes9x',
	mupen64plus_next: 'mupen64plus',
	vba_next: 'vba',
	nestopia_ue: 'nestopia',
	genesis_plus_gx: 'genesis_plus_gx',
	pcsx_rearmed: 'pcsx_rearmed',
};

/**
 * The emulator name to record on a save written by a placed core.
 *
 * RomM names a save by the emulator that wrote it, and RetroArch's cores
 * are exactly the stand-alone emulators behind those names — the mgba core
 * *is* mGBA — so a save the user made elsewhere with the stand-alone
 * emulator pairs with the one the core writes here. The name is derived
 * from the core file name (`mgba_libretro_libnx.nro` → `mgba`); whatever
 * cannot be resolved degrades to `retroarch`.
 */
export function emulatorNameForCoreFile(fileName: string): string {
	const dot = fileName.lastIndexOf('.');
	let name = (dot > 0 ? fileName.slice(0, dot) : fileName).toLowerCase();
	const libretro = name.indexOf('_libretro');
	if (libretro > 0) name = name.slice(0, libretro);
	name = name.replace(/\.(nro|so)$/, '').replace(/_libretro$/, '');
	if (name === '') return 'retroarch';
	return EMULATOR_NAMES[name] ?? name;
}
