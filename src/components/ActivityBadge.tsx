import React, { useSyncExternalStore } from 'react';
import { Rect, Text, useDimensions, useParent } from 'react-tela';
import { getActivities, subscribeActivity } from '../activity';
import { colors, fontFamily, fontSize, radius } from '../theme';
import { measure } from '../text';
import { useTick } from '../hooks/use-tick';

/** Vertical position of the badge (below the header's count + build stamp). */
const Y = 88;
const H = 26;
const PAD = 10;

/** How often the badge's dots move on. */
const SPINNER_TICK_MS = 300;
/** Distance between the badge's dots. */
const DOT_GAP = 7;
/** Radius of the dot that is "active". */
const BIG_R = 3;
/** Radius of the dots that are not. */
const SMALL_R = 2;
/** The dot cluster's footprint inside the pill. */
const DOTS_W = DOT_GAP * 2 + BIG_R * 2 + 8;

/**
 * Top-right toast that shows what is running in the background — the
 * library page walk at connect time, the artwork prefetch while browsing,
 * and anything else that reports into the activity store.
 *
 * It renders nothing while idle, so it never competes with cover art for
 * attention; a short line appears only for as long as work is in flight.
 * A small dot cluster marks an in-flight activity, and a library label
 * carries the walk's completion, e.g. "Library 37%".
 */
export function ActivityBadge() {
	const dims = useDimensions();
	const { ctx } = useParent();
	const activities = useSyncExternalStore(subscribeActivity, getActivities);

	// The dots only move while something actually runs, so an idle badge
	// repaints nothing.
	const hasSpinner = activities.some((a) => a.key === 'library');
	const tick = useTick(SPINNER_TICK_MS, hasSpinner);

	if (activities.length === 0) return null;

	const label = activities.map((a) => a.label).join('  ·  ');
	const textWidth = measure(ctx, label, fontSize.tiny);
	const dotsW = hasSpinner ? DOTS_W : 0;
	const pillW = textWidth + PAD * 2 + dotsW;
	const x = dims.width - 24 - pillW;
	const step = tick % 3;

	return (
		<>
			<Rect
				x={x}
				y={Y}
				width={pillW}
				height={H}
				fill={colors.surfaceRaised}
				stroke={colors.borderStrong}
				lineWidth={1}
				borderRadius={radius.pill}
			/>
			{hasSpinner &&
				[0, 1, 2].map((i) => {
					const on = i === step;
					const r = on ? BIG_R : SMALL_R;
					return (
						<Rect
							key={i}
							x={x + PAD + (i - 1) * DOT_GAP - r}
							y={Y + H / 2 - r}
							width={r * 2}
							height={r * 2}
							fill={on ? colors.accent : colors.coverGlyph}
							borderRadius={r}
						/>
					);
				})}
			<Text
				x={x + PAD + dotsW}
				y={Y + 5}
				fontFamily={fontFamily}
				fontSize={fontSize.tiny}
				fill={colors.textSecondary}
			>
				{label}
			</Text>
		</>
	);
}
