import React from 'react';
import { Rect, Text, useDimensions } from 'react-tela';
import { BUILD_ID } from '../version';

/**
 * Full-screen failure notice.
 *
 * Shown instead of the app when something threw while rendering. Everything
 * here is a plain `Rect`/`Text` pair — no grouping, no offscreen compositing —
 * so it still works when the renderer itself is what failed.
 */
export function FatalError({ message }: { message: string }) {
	const dims = useDimensions();
	const body = message.length > 400 ? `${message.slice(0, 400)}…` : message;

	return (
		<>
			<Rect width={dims.width} height={dims.height} fill="#1a0c0c" />
			<Text x={40} y={44} fontSize={36} fill="#ff8a8a">
				RomMmate — render error
			</Text>
			<Text
				x={40}
				y={120}
				maxWidth={dims.width - 80}
				fontSize={20}
				lineHeight={1.35}
				fill="#ffb3b3"
				overflow="wrap"
			>
				{body}
			</Text>
			<Text x={40} y={dims.height - 56} fontSize={18} fill="#8a6a6a">
				{`build ${BUILD_ID}`}
			</Text>
		</>
	);
}
