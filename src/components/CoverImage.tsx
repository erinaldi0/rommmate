import React, { useState } from 'react';
import { Image } from 'react-tela';
import { resolveCover } from '../covers';

/** Where the artwork of a cover is in its journey. */
export type CoverStatus = 'loading' | 'ready' | 'failed';

interface Props {
	/** Absolute URL of the artwork. Empty means "there is none". */
	url: string;
	x: number;
	y: number;
	width: number;
	height: number;
	/**
	 * Called once the artwork is available locally. The tile uses it to
	 * hide the placeholder glyph underneath.
	 */
	onLoaded?: () => void;
	/**
	 * Reports what the artwork is doing: 'loading' while the bytes are on
	 * their way, 'ready' once they are, 'failed' when they never arrive.
	 */
	onStatus?: (status: CoverStatus) => void;
}

/**
 * Cover art with a safe failure mode.
 *
 * react-tela's `<Image>` rejects (and takes the whole frame down with it)
 * when the source cannot be loaded, so the bytes are resolved first by
 * `covers.ts` and the `<Image>` is only mounted once a working source is
 * known. Until then this renders nothing and the caller keeps its
 * placeholder visible.
 */
export function CoverImage({ url, x, y, width, height, onLoaded, onStatus }: Props) {
	const [src, setSrc] = useState('');

	React.useEffect(() => {
		if (url === '') {
			setSrc('');
			onStatus?.('ready');
			return;
		}

		let cancelled = false;
		onStatus?.('loading');

		resolveCover(url).then((resolved) => {
			if (cancelled) return;
			if (resolved === '') {
				onStatus?.('failed');
				return;
			}
			setSrc(resolved);
			onStatus?.('ready');
			onLoaded?.();
		});

		return () => {
			cancelled = true;
		};
		// `onLoaded` and `onStatus` are intentionally not dependencies: they
		// are notifications, not inputs, and re-running the effect on every
		// callback change would restart the download.
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [url]);

	if (src === '') return null;

	return (
		<Image
			src={src}
			x={x}
			y={y}
			width={width}
			height={height}
			imageSmoothingQuality="high"
		/>
	);
}
