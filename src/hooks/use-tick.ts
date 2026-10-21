import { useEffect, useState } from 'react';

/**
 * Re-renders the component on a fixed interval while `active` is true.
 *
 * The canvas UI has no CSS animations, so anything that moves (a spinner, a
 * pulse) needs a tick to drive it. The interval is deliberately coarse:
 * the whole scene is re-rainted on every tick, so this is for slow feedback
 * (a loading indicator), never for anything the player drags around.
 */
export function useTick(intervalMs: number, active: boolean): number {
	const [tick, setTick] = useState(0);

	useEffect(() => {
		if (!active) return;
		// The counter is never wrapped: a spinner that derives its angle
		// from it would jump every time the counter rolled over.
		const id = setInterval(() => setTick((t) => t + 1), intervalMs);
		return () => clearInterval(id);
	}, [intervalMs, active]);

	return tick;
}
