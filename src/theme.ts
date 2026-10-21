/**
 * Design tokens for the canvas UI.
 *
 * react-tela paints straight onto a canvas: there is no CSS cascade to
 * inherit from, so every colour, size and radius has to be named and shared
 * explicitly. Keeping them in one place is what makes the screens read as a
 * single product instead of a pile of hand-tuned screens.
 *
 * The palette is deliberately small — a near-black background, two surface
 * steps, one accent, and a muted text ramp — so that cover art (which is
 * colourful and unpredictable) stays the loudest thing on screen.
 */

export const colors = {
	/** App background. */
	bg: '#101018',
	/** Slightly darker than `bg` — used to mask content behind the chrome. */
	sunken: '#0b0b12',
	/** Default panel / row background. */
	surface: '#171722',
	/** Raised panel: focused rows, selected chips. */
	surfaceRaised: '#232338',
	/** Hairline border. */
	border: '#262636',
	/** Border for elements that need to stand out from the surface. */
	borderStrong: '#3a3a56',

	/** The single accent colour: focus rings, selection, primary actions. */
	accent: '#5b8cff',
	/** Accent at low intensity — chip backgrounds, pressed states. */
	accentMuted: '#2b3a63',

	textPrimary: '#ffffff',
	textSecondary: '#a8a8c0',
	textMuted: '#6a6a85',
	textFaint: '#4a4a60',

	danger: '#e06060',
	dangerMuted: '#3a1c1c',
	warning: '#e0b060',
	success: '#5fc08a',

	/** Placeholder tile behind missing cover art. */
	coverBg: '#1c1c2a',
	coverGlyph: '#3c3c58',
	coverGlyphText: '#4a4a6e',
} as const;

/** Spacing scale — every gap in the UI is one of these. */
export const space = {
	xs: 4,
	sm: 8,
	md: 12,
	lg: 16,
	xl: 24,
	xxl: 32,
} as const;

/** Corner radii. */
export const radius = {
	sm: 6,
	md: 8,
	lg: 10,
	xl: 12,
	pill: 999,
} as const;

/** Type scale (px). */
export const fontSize = {
	hero: 64,
	display: 40,
	title: 30,
	heading: 24,
	body: 20,
	label: 18,
	small: 16,
	tiny: 14,
} as const;

/** The Switch system font — available in every nx.js environment. */
export const fontFamily = 'system-ui';
