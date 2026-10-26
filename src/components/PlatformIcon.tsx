/**
 * A bundled platform icon: the platform art `platform-icons.ts` resolves,
 * drawn through react-tela's `<Image>` with the same safe-mount contract
 * as `CoverImage`.
 *
 * The renderer's `<Image>` rejects when a source cannot be loaded — and
 * an unhandled rejection takes the whole frame down — so the src is
 * proven with a plain decode first and the `<Image>` is only mounted
 * once it is known to work. A bundled icon is a 48×48 PNG in romfs, so
 * the probe is a local read and cannot really fail; the guard exists
 * because "cannot really" is not "cannot".
 *
 * The re-insert kick mirrors `CoverImage` too: React moves an entity by
 * removing and re-adding it, and an unchanged `src` starts no new load —
 * without the kick, an icon that moves mid-scroll (the chips strip pans,
 * the filter bar scrolls) could sit un-painted.
 */
import React, { useLayoutEffect, useRef, useState } from 'react';
// Aliased: the JSX component would shadow the runtime's global `Image`
// class, which the decode probe below needs (`new Image()`).
import { Image as TelaImage } from 'react-tela';
import { platformIconSrc } from '../platform-icons';

export interface PlatformIconProps {
	/** The platform slug (as `platform-icons.ts` resolves it). */
	slug: string;
	x: number;
	y: number;
	/** The drawn square's edge. The bundled art is 48 px, so ≤ 48 stays crisp. */
	size?: number;
}

export function PlatformIcon({ slug, x, y, size = 24 }: PlatformIconProps) {
	const src = platformIconSrc(slug);
	const [ready, setReady] = useState(false);
	const entityRef = React.useRef<React.ElementRef<typeof TelaImage> | null>(null);

	// Prove the source decodes before mounting the renderer's `<Image>`
	// (see the module comment). One probe per mount; the romfs read is a
	// local file, so this resolves in a frame.
	React.useEffect(() => {
		setReady(false);
		if (src === '') return;
		let cancelled = false;
		const probe = new Image();
		probe.onload = () => {
			if (!cancelled) setReady(true);
		};
		probe.onerror = () => {
			/* a broken bundled icon stays hidden — the label carries the chip */
		};
		probe.src = src;
		return () => {
			cancelled = true;
		};
	}, [src]);

	// A moved entity (removed and re-added with the same src) starts no
	// new load on its own — kick it. Same layout-effect discipline as
	// `CoverImage`: the listener must be attached by the commit that
	// mounted the entity, so a move in the very next commit finds it.
	useLayoutEffect(() => {
		if (!ready) return;
		const entity = entityRef.current;
		if (entity === null) return;
		const onReinsert = () => {
			void entityRef.current?.loadImage();
		};
		entity.addEventListener('add', onReinsert);
		return () => {
			entity.removeEventListener('add', onReinsert);
		};
	}, [ready]);

	if (src === '' || !ready) return null;

	return (
		<TelaImage
			ref={entityRef}
			src={src}
			x={x}
			y={y}
			width={size}
			height={size}
			imageSmoothingQuality="high"
		/>
	);
}
