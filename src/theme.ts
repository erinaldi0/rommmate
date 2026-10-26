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
	bg: '#101019',
	/** Slightly darker than `bg` — used to mask content behind the chrome. */
	sunken: '#0b0b13',
	/** Default panel / row background. */
	surface: '#191925',
	/** Raised panel: focused rows, selected chips. */
	surfaceRaised: '#232337',
	/** Highest surface: overlays, popups, the disc picker. */
	surfaceOverlay: '#2b2b45',
	/** Hairline border. */
	border: '#262639',
	/** Border for elements that need to stand out from the surface. */
	borderStrong: '#3a3a56',

	/** The single accent colour: focus rings, selection, primary actions. */
	accent: '#7895FF',
	/** Accent at low intensity — chip backgrounds, pressed states. */
	accentMuted: '#2d3a66',
	/** Deeper accent, for gradient fills. */
	accentDark: '#5b78e8',

	textPrimary: '#F4F2FF',
	textSecondary: '#A2A1BA',
	textMuted: '#6F708C',
	textFaint: '#4c4d63',

	danger: '#e06060',
	dangerMuted: '#3a1c1c',
	warning: '#e0b060',
	warningMuted: '#3a2f1c',
	success: '#59C99A',
	successMuted: '#1e3a30',

	/** Placeholder tile behind missing cover art. */
	coverBg: '#1d1d2b',
	coverGlyph: '#3d3d5c',
	coverGlyphText: '#4a4a6e',
	/** Base of the translucent gradient scrims (the blur substitute). */
	scrim: '#0a0a12',

	/**
	 * The core of the ambient background: the soft indigo pool of light the
	 * home screen sits in (see `AmbientBackdrop`). A lift of `bg` toward
	 * `accentMuted` — deliberately quiet, so cover art stays the loudest
	 * thing on screen.
	 */
	ambient: '#1d1d36',
	/** The accent as a translucent glow — the focused target's halo. */
	accentGlow: 'rgba(120,149,255,0.45)',
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
	/** Half a 6 px bar/pill, so a thin bar reads as a full pill. */
	'2xs': 3,
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
	/** Game / section titles. */
	headline: 32,
	title: 30,
	heading: 24,
	body: 20,
	label: 18,
	small: 16,
	tiny: 14,
	/** Chips, button labels, meta labels, keycap letters. */
	micro: 12,
} as const;

/** The Switch system font — available in every nx.js environment. */
export const fontFamily = 'system-ui';

/**
 * ── Design-system tokens ─────────────────────────────────────────────────
 *
 * Everything below is the structured part of the system: the type hierarchy,
 * the elevation model, the general layout metrics and the named durations.
 * The primitives in `components/ui/` read from these; the screens read from
 * the primitives. A change here lands everywhere at once.
 */

/** The one canvas the whole app paints into (1280×720, landscape). */
export const screen = { width: 1280, height: 720 } as const;

/** General layout metrics shared by every screen. */
export const layout = {
	/** The left/right screen margin. */
	margin: 24,
	/** The bottom hint bar owns this strip (it is drawn over content). */
	hintBar: { height: 72 },
	/** Default gutter between grid tiles. */
	gutter: 24,
} as const;

/**
 * Semantic type roles. The device font is normal-weight only (the runtime
 * cannot produce bold and tries to OOM), so hierarchy comes from size +
 * colour, never from weight. Each role names its size (from `fontSize`),
 * its default colour and its default baseline.
 */
export type TypeRole =
	| 'display'
	| 'headline'
	| 'title'
	| 'heading'
	| 'body'
	| 'label'
	| 'caption'
	| 'micro';

/**
 * The type hierarchy: a role's size, default colour and baseline. The
 * `Text` primitive pairs a role with these so callers write a role, not a
 * hand-tuned trio of props.
 */
export const type: Record<
	TypeRole,
	{ size: number; color: string; baseline: CanvasTextBaseline }
> = {
	display: { size: fontSize.display, color: colors.textPrimary, baseline: 'alphabetic' },
	headline: { size: fontSize.headline, color: colors.textPrimary, baseline: 'alphabetic' },
	title: { size: fontSize.title, color: colors.textPrimary, baseline: 'alphabetic' },
	heading: { size: fontSize.heading, color: colors.textPrimary, baseline: 'alphabetic' },
	body: { size: fontSize.body, color: colors.textSecondary, baseline: 'alphabetic' },
	label: { size: fontSize.label, color: colors.textSecondary, baseline: 'alphabetic' },
	caption: { size: fontSize.small, color: colors.textMuted, baseline: 'alphabetic' },
	micro: { size: fontSize.micro, color: colors.textMuted, baseline: 'alphabetic' },
};

/**
 * Elevation: how far a surface lifts off the background.
 *
 * `flat` sits on the background, `raised` and `overlay` add a hairline, and
 * only `floating` adds a shadow. `shadowBlur` is the one real-but-costly
 * effect on the 32-bit heap, so it is opt-in and never the default: the
 * bulk of the UI reads as "premium" from the three surface steps alone.
 */
export type ElevationName = 'flat' | 'raised' | 'overlay' | 'floating';

export interface ElevationStyle {
	fill: string;
	stroke: string | null;
	shadow: { color: string; blur: number; offsetY: number } | null;
}

export const elevation: Record<ElevationName, ElevationStyle> = {
	flat: { fill: colors.bg, stroke: null, shadow: null },
	raised: { fill: colors.surface, stroke: colors.border, shadow: null },
	overlay: { fill: colors.surfaceRaised, stroke: colors.border, shadow: null },
	floating: {
		fill: colors.surfaceRaised,
		stroke: colors.borderStrong,
		shadow: { color: 'rgba(0,0,0,0.5)', blur: 18, offsetY: 10 },
	},
};

/**
 * Named durations for the tick-driven feedback. The canvas UI has no CSS
 * transitions: anything that moves is re-painted on a coarse tick, so these
 * are the only "animation" constants and they are deliberately slow.
 */
export const motion = {
	/** How often a spinner / pulsing indicator ticks. */
	spinnerTick: 300,
	/** How often a focus pulse ticks (a subtler, faster beat). */
	focusTick: 150,
} as const;
