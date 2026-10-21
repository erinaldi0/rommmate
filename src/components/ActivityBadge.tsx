import React, { useSyncExternalStore } from 'react';
import { Rect, Text, useDimensions, useParent } from 'react-tela';
import { getActivities, subscribeActivity } from '../activity';
import { colors, fontFamily, fontSize, radius } from '../theme';
import { measure } from '../text';

/** Vertical position of the badge (below the header's count + build stamp). */
const Y = 88;
const H = 26;
const PAD = 10;

/**
 * Top-right toast that shows what is running in the background — the
 * library page walk at connect time, the artwork prefetch while browsing,
 * and anything else that reports into the activity store.
 *
 * It renders nothing while idle, so it never competes with cover art for
 * attention; a short line appears only for as long as work is in flight.
 */
export function ActivityBadge() {
	const dims = useDimensions();
	const { ctx } = useParent();
	const activities = useSyncExternalStore(subscribeActivity, getActivities);

	if (activities.length === 0) return null;

	const label = activities.map((a) => a.label).join('  ·  ');
	const textWidth = measure(ctx, label, fontSize.tiny);
	const pillW = textWidth + PAD * 2;
	const x = dims.width - 24 - pillW;

	return (
		<>
			<Rect x={x} y={Y} width={pillW} height={H} fill={colors.surfaceRaised} stroke={colors.borderStrong} lineWidth={1} borderRadius={radius.pill} />
			<Text x={x + PAD} y={Y + 5} fontFamily={fontFamily} fontSize={fontSize.tiny} fill={colors.textSecondary}>
				{label}
			</Text>
		</>
	);
}
