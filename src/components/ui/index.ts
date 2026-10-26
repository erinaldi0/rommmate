/**
 * The RomMmate design system — one import for the whole thing.
 *
 * This is the presentation layer the screens build from. It is deliberately
 * renderer-native (react-tela entities, no DOM / CSS / flexbox) and
 * presentation-only: every state is a controlled prop, and nothing here knows
 * about the RomM data layer or the gamepad loop. The token objects are
 * re-exported too, so a screen can reach a raw token without a second import.
 *
 *   import { Panel, Button, Chip, ProgressBar, CoverCard, colors, type, ... } from './ui';
 */

// ── Tokens ──────────────────────────────────────────────────────────────────
export {
	colors,
	space,
	radius,
	fontSize,
	fontFamily,
	type,
	layout,
	screen,
	motion,
	elevation,
} from '../../theme';
export type { TypeRole, ElevationName, ElevationStyle } from '../../theme';

// ── Primitives ──────────────────────────────────────────────────────────────
export { Surface, Panel, Scrim, Backdrop, AmbientBackdrop } from './Surface';
export type { SurfaceProps, PanelProps, ScrimProps, ScrimDirection, AmbientBackdropProps } from './Surface';

export { Text, SectionHeading, Field } from './Text';
export type { TextProps, SectionHeadingProps, FieldProps } from './Text';

export { Button, buttonSize } from './Button';
export type { ButtonProps, ButtonVariant, ButtonSize } from './Button';

export { Keycap, Hint, HintBar } from './Keycap';
export type { KeycapProps, KeycapTone, HintProps, HintBarProps } from './Keycap';

export { Chip, StatusChip, Badge, chipWidth } from './Chip';
export type { ChipProps, ChipTone, ChipSize, StatusChipProps, BadgeProps, BadgeTone } from './Chip';

export { FocusRing } from './FocusRing';
export type { FocusRingProps } from './FocusRing';

export { ProgressBar } from './ProgressBar';
export type { ProgressBarProps, ProgressTone } from './ProgressBar';

export { CoverCard, coverCardTextH } from './CoverCard';
export type { CoverCardProps } from './CoverCard';

export { Spinner, EmptyState, LoadingState, ErrorState } from './States';
export type {
	SpinnerProps,
	EmptyStateProps,
	LoadingStateProps,
	ErrorStateProps,
	StateAction,
} from './States';

// ── Layout helpers ──────────────────────────────────────────────────────────
export { clampScroll, visibleRange, centerX, colX, rowY } from './layout';
