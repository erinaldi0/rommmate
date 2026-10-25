import React, { useState } from 'react';
import { Image } from 'react-tela';
import { resolveCover, type Fit } from '../covers';

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
	 * How the artwork is fitted into the box. 'cover' stretches it to fill
	 * (the artwork's own aspect is ~the box's); 'contain' letterboxes it on
	 * a transparent background, for artwork whose aspect differs (the
	 * `<Image>` itself can only stretch, so the letterboxing is baked into
	 * the bytes the cover pipeline resolves).
	 */
	fit?: Fit;
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
	/**
	 * Whether this artwork should be fetched at all. A tile that is not
	 * actually on screen (beyond the viewport's edge) keeps its placeholder
	 * and downloads nothing — on-device memory is the binding constraint,
	 * so the dashboard only fetches the covers it displays. Turning the
	 * gate on (the tile entering the viewport) starts the normal resolve.
	 */
	enabled?: boolean;
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
export function CoverImage({
	url,
	x,
	y,
	width,
	height,
	fit = 'cover',
	onLoaded,
	onStatus,
	enabled = true,
}: Props) {
	const [src, setSrc] = useState('');
	const entityRef = React.useRef<React.ElementRef<typeof Image> | null>(null);

	// The renderer aborts an artwork load the moment its entity leaves the
	// tree, and nothing restarts it when the same instance is inserted
	// again: React moves a tile by removing it and re-adding it, and an
	// unchanged `src` prop starts no new load. A tile that moves while its
	// artwork is still decoding would therefore sit on its dark plate
	// forever — which is exactly what happened to covers that arrived
	// mid-stream while the library was still filling in. An `add` event
	// after the mount is such a re-insertion, so kick the load again; by
	// then the bytes are local (a cached blob, an SD file), so the retry
	// is a cheap re-decode. A layout effect so the listener is attached
	// synchronously with the commit that mounted the entity — a move in
	// the very next commit must find it.
	React.useLayoutEffect(() => {
		if (src === '') return;
		const entity = entityRef.current;
		if (entity === null) return;
		const onReinsert = () => {
			void entityRef.current?.loadImage();
		};
		entity.addEventListener('add', onReinsert);
		return () => {
			entity.removeEventListener('add', onReinsert);
		};
	}, [src]);

	React.useEffect(() => {
		if (url === '') {
			setSrc('');
			onStatus?.('ready');
			return;
		}
		if (!enabled) {
			// Off-screen: the plate and glyph stay, nothing downloads. The
			// status falls back to 'loading' so the placeholder logic in
			// the caller keeps the tile's plate drawn.
			setSrc('');
			onStatus?.('loading');
			return;
		}

		let cancelled = false;
		onStatus?.('loading');

		// The artwork is resolved for THIS box: the pipeline returns a
		// display-sized copy (see covers.ts), so the `<Image>` below paints
		// it 1:1 instead of resampling the source every frame.
		resolveCover(url, width, height, fit).then((resolved) => {
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
		// callback change would restart the download. `width`, `height` and
		// `fit` are: a different box is a different artwork to fetch.
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [enabled, url, width, height, fit]);

	if (src === '') return null;

	return (
		<Image
			ref={entityRef}
			src={src}
			x={x}
			y={y}
			width={width}
			height={height}
			imageSmoothingQuality="high"
		/>
	);
}
