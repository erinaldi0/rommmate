/**
 * Platform icons: the app's map from a platform to its bundled artwork.
 *
 * RomM's own platform artwork ships with the app (generated into
 * `romfs/assets/platforms/` by `tools/icons/generate.mjs`, from the
 * RomM project's asset set — CC BY 4.0, mostly Libretro's; see the
 * ATTRIBUTIONS beside the PNGs). The server serves the same art as
 * `.ico`, a format the Switch runtime cannot decode (nx.js `Image` is
 * PNG / JPEG / WebP only), so on-device the chips strip used to show
 * text-only while the browser preview happily drew the ICOs — the
 * bundled PNGs close that gap, work offline, and land instantly.
 *
 * How a platform finds its slug, best first:
 *   1. its own artwork URL — RomM serves platform art under
 *      `…/platforms/<slug>.ico`, so the file it names is the slug;
 *   2. a table of common display names (the demo library has no server,
 *      and the grid's filter chips know platforms by name only);
 *   3. the generic `default` icon (RomM's own convention for platforms
 *      it does not know — and it is in the set too).
 *
 * Every resolution is checked against the generated manifest, so an
 * unmapped name or a foreign URL can never produce a broken image
 * reference — it simply falls through to the next step.
 */
import { PLATFORM_ICON_SLUGS } from './platform-icons.generated';

/** The bundled slugs — the manifest the generated PNGs are known by. */
const SLUGS = new Set(PLATFORM_ICON_SLUGS);

/** The generic icon (a gamepad) RomM uses for unknown platforms. */
export const DEFAULT_PLATFORM_SLUG = 'default';

/**
 * The slug sanitisation the generator applies to its file names (spaces
 * and anything else outside `[A-Za-z0-9._-]` become `-`). The runtime
 * applies the same rule, so a slug straight off a URL matches the PNG
 * it names.
 */
export function sanitizeSlug(slug: string): string {
	return slug.replace(/[^a-zA-Z0-9._-]+/g, '-');
}

/**
 * Common display names → RomM platform slugs. Keys are normalised
 * (lower-cased, stripped of everything but alphanumerics) at lookup, so
 * "TurboGrafx-16", "Turbografx 16" and "turbografx16" all hit. Every
 * value is a bundled slug — the generator keeps the manifest honest.
 */
const NAME_TO_SLUG: Record<string, string> = {
	// Nintendo
	nintendo64: 'n64',
	n64: 'n64',
	supernintendo: 'snes',
	supernintendoentertainmentsystem: 'snes',
	snes: 'snes',
	nintendoentertainmentsystem: 'nes',
	nes: 'nes',
	famicom: 'famicom',
	nintendofamicom: 'famicom',
	gamecube: 'ngc',
	nintendogamecube: 'ngc',
	ngc: 'ngc',
	nintendoswitch: 'switch',
	switch: 'switch',
	nintendods: 'nds',
	nds: 'nds',
	nintendodsi: 'nintendo-dsi',
	nintendo3ds: '3ds',
	'3ds': '3ds',
	wii: 'wii',
	wiiu: 'wiiu',
	gameboy: 'gb',
	gb: 'gb',
	gameboycolor: 'gbc',
	gbc: 'gbc',
	gameboyadvance: 'gba',
	gba: 'gba',
	virtualboy: 'virtualboy',
	pokemonmini: 'pokemon-mini',
	famicomdisksystem: 'fds',
	nintendofamicomdisksystem: 'fds',
	fds: 'fds',
	satellaview: 'satellaview',
	gameandwatch: 'g-and-w',
	// Sony
	playstation: 'psx',
	sonyplaystation: 'psx',
	psx: 'psx',
	ps1: 'psx',
	playstation2: 'ps2',
	ps2: 'ps2',
	playstation3: 'ps3',
	ps3: 'ps3',
	playstation4: 'ps4',
	ps4: 'ps4',
	playstation5: 'ps5',
	ps5: 'ps5',
	playstationportable: 'psp',
	psp: 'psp',
	playstationvita: 'psvita',
	psvita: 'psvita',
	vita: 'psvita',
	// Sega
	segagenesis: 'genesis',
	genesis: 'genesis',
	segamegadrive: 'genesis',
	megadrive: 'md',
	segamastersystem: 'sms',
	mastersystem: 'sms',
	sms: 'sms',
	segasaturn: 'saturn',
	saturn: 'saturn',
	segadreamcast: 'dc',
	dreamcast: 'dc',
	dc: 'dc',
	segacd: 'segacd',
	segamegacd: 'segacd',
	megacd: 'segacd',
	sega32x: '32x',
	'32x': '32x',
	gamegear: 'gamegear',
	segagamegear: 'gamegear',
	segapico: 'sega-pico',
	sg1000: 'sg1000',
	segasg1000: 'sg1000',
	// Arcade & SNK
	arcade: 'arcade',
	neogeo: 'neogeomvs',
	seganaomi: 'atomiswave',
	atomiswave: 'atomiswave',
	neogeocd: 'neo-geo-cd',
	neogeopocket: 'neo-geo-pocket',
	neogeopocketcolor: 'neo-geo-pocket-color',
	// Atari
	atari2600: 'atari2600',
	atari5200: 'atari5200',
	atari7800: 'atari7800',
	atari800: 'atari800',
	atari8bit: 'atari8bit',
	atarist: 'atari-st',
	atarijaguar: 'jaguar',
	jaguar: 'jaguar',
	atarilynx: 'lynx',
	lynx: 'lynx',
	// Commodore & Amstrad & Sinclair
	commodore64: 'c64',
	c64: 'c64',
	amiga: 'amiga',
	commodoreamiga: 'amiga',
	amigacd32: 'amiga-cd32',
	vic20: 'vic-20',
	commodorevic20: 'vic-20',
	cdtv: 'commodore-cdtv',
	amstradcpc: 'acpc',
	cpc: 'acpc',
	zxspectrum: 'zxs',
	// NEC / others
	pcengine: 'pce',
	pce: 'pce',
	turbografx16: 'tg16',
	turbografx: 'tg16',
	tg16: 'tg16',
	pcenginecd: 'pcecd',
	turbografxcd: 'turbografx-cd',
	pc98: 'pc-9800-series',
	pcfx: 'pc-fx',
	msx: 'msx',
	msx2: 'msx2',
	// Microsoft
	xbox: 'xbox',
	microsoftxbox: 'xbox',
	xbox360: 'xbox360',
	xboxone: 'xboxone',
	xboxseriesx: 'series-x',
	seriesx: 'series-x',
	// Computers & misc
	dos: 'dos',
	pc: 'win',
	windows: 'win',
	microsoftwindows: 'win',
	win: 'win',
	linux: 'linux',
	macos: 'mac',
	macintosh: 'mac',
	mac: 'mac',
	ios: 'ios',
	android: 'android',
	scummvm: 'scummvm',
	intellivision: 'intellivision',
	coleco: 'coleco',
	colecovision: 'colecovision',
	vectrex: 'vectrex',
	magnavoxodyssey: 'odyssey',
	odyssey: 'odyssey',
	odyssey2: 'odyssey-2',
	magnavoxodyssey2: 'odyssey-2',
	fairchildchannelf: 'fairchild-channel-f',
	channelf: 'fairchild-channel-f',
	philipscdi: 'philips-cd-i',
	cdi: 'philips-cd-i',
	sharpx68000: 'sharp-x68000',
	x68000: 'sharp-x68000',
	'3do': '3do',
	wonderswan: 'wonderswan',
	wonderswancolor: 'wonderswan-color',
	sufamiturbo: 'sufami-turbo',
	pico8: 'pico-8',
	supervision: 'supervision',
	megaduck: 'megaduck',
	casioloopy: 'loopy',
	loopy: 'loopy',
	ngage: 'ngage',
	nokiangage: 'ngage',
	gizmondo: 'gizmondo',
	leapster: 'leapster',
};

/** A display name reduced to its lookup key (lower-cased alphanumerics). */
function normalizeName(name: string): string {
	return name.toLowerCase().replace(/[^a-z0-9]+/g, '');
}

/**
 * The slug a platform's own artwork URL names — RomM serves platform art
 * under `…/platforms/<slug>.ico`, so when the URL is one of those, the
 * file it names is the slug. External artwork (IGDB logos) lives on a
 * different host and names nothing.
 */
function slugFromLogoUrl(logoUrl: string): string {
	const marker = '/platforms/';
	const i = logoUrl.indexOf(marker);
	if (i === -1) return '';
	const base = logoUrl.slice(i + marker.length).split(/[?#]/)[0];
	const dot = base.lastIndexOf('.');
	return dot > 0 ? base.slice(0, dot) : '';
}

/** True when a bundled PNG exists for `slug` (after sanitisation). */
export function hasPlatformIcon(slug: string): boolean {
	return SLUGS.has(sanitizeSlug(slug));
}

/**
 * The bundled slug for a platform — its own artwork URL's slug, else the
 * display-name table, else '' when neither names a bundled icon. Callers
 * with their own richer fallback (the chips strip can still draw the
 * server's art) use this; everyone else wants `platformIconSlug`.
 */
export function platformIconSlugExact(name: string, logoUrl: string): string {
	const fromUrl = slugFromLogoUrl(logoUrl);
	if (fromUrl !== '' && hasPlatformIcon(fromUrl)) return sanitizeSlug(fromUrl);
	const mapped = NAME_TO_SLUG[normalizeName(name)];
	if (mapped !== undefined && hasPlatformIcon(mapped)) return mapped;
	return '';
}

/**
 * The bundled slug for a platform, bottoming out at the generic icon —
 * exactly like RomM's own platforms page, an unknown platform shows the
 * gamepad rather than nothing. '' is never returned.
 */
export function platformIconSlug(name: string, logoUrl: string): string {
	return platformIconSlugExact(name, logoUrl) || DEFAULT_PLATFORM_SLUG;
}

/**
 * Where the bundled icon PNGs live. On the device that is the NRO's own
 * romfs; in the browser preview harness it is the repo's `romfs/`
 * directory over the harness's static server (the same files).
 */
const ICON_BASE =
	typeof (globalThis as { Switch?: unknown }).Switch === 'object' ? 'romfs:' : '/romfs';

/**
 * The drawable `<Image>` source for a bundled slug, or '' when the slug
 * is not in the manifest. Callers hand this to `PlatformIcon` after
 * resolving a platform (or fall back themselves when it is empty).
 */
export function platformIconSrc(slug: string): string {
	const s = sanitizeSlug(slug);
	return SLUGS.has(s) ? `${ICON_BASE}/assets/platforms/${s}.png` : '';
}
