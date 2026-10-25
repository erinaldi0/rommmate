/**
 * The decode → scale → PNG-encode pipeline.
 *
 * The heavy steps (decode, resample, re-encode) run natively in the
 * platform's image/canvas primitives; this module only drives them. It is
 * capability-probed rather than required: a platform missing any piece
 * (OffscreenCanvas, convertToBlob, …) simply gets the original bytes —
 * every step must fail silent, because a broken cover can never take the
 * app down. Used by the cache in `index.ts` to produce the master copy
 * and the per-(size, fit) display-sized copies.
 */
import type { Fit } from './index';

/**
 * Longest edge of the cached master copy, in pixels.
 *
 * The master is the on-disk source of truth from which every display
 * size is derived, so 640 keeps a derivation crisp for every consumer
 * (grid 216×288, detail 200×267, dashboard 108×144) while capping the
 * master's own decode at ~1.5 MiB of RGBA — full-size server art (scans
 * run into thousands of pixels) was the dominant native-memory consumer
 * while scrolling.
 */
const MAX_DIM = 640;
/** The pieces of the decode/scale pipeline the platform must provide. */
interface RenderPipeline {
	image: new () => {
		naturalWidth: number;
		naturalHeight: number;
		onload: (() => void) | null;
		onerror: (() => void) | null;
		src: string;
	};
	blob: typeof Blob;
	canvas: new (w: number, h: number) => {
		getContext(id: '2d'): {
			imageSmoothingEnabled: boolean;
			imageSmoothingQuality: string;
			drawImage(img: unknown, dx: number, dy: number, dw: number, dh: number): void;
		};
		convertToBlob(opts: { type: string }): Promise<Blob>;
	};
	url: {
		createObjectURL: (b: Blob) => string;
		revokeObjectURL: (u: string) => void;
	};
}

/** The platform's pipeline, or null when it lacks any piece of it. */
function pipeline(): RenderPipeline | null {
	const g = globalThis as unknown as {
		Image?: RenderPipeline['image'];
		Blob?: typeof Blob;
		OffscreenCanvas?: RenderPipeline['canvas'];
		URL?: {
			createObjectURL?: (b: Blob) => string;
			revokeObjectURL?: (u: string) => void;
		};
	};
	const ImageCtor = g.Image;
	const BlobCtor = g.Blob;
	const CanvasCtor = g.OffscreenCanvas;
	const createObjectUrl = g.URL?.createObjectURL;
	const revokeObjectUrl = g.URL?.revokeObjectURL;
	if (
		typeof ImageCtor !== 'function' ||
		typeof BlobCtor !== 'function' ||
		typeof CanvasCtor !== 'function' ||
		typeof createObjectUrl !== 'function'
	) {
		return null;
	}
	return {
		image: ImageCtor,
		blob: BlobCtor,
		canvas: CanvasCtor,
		url: {
			createObjectURL: createObjectUrl,
			revokeObjectURL: (u: string) => {
				if (typeof revokeObjectUrl !== 'function') return;
				try {
					revokeObjectUrl(u);
				} catch {
					/* ignore */
				}
			},
		},
	};
}

/** A decoded image plus the object URL that keeps it alive. */
interface DecodedImage {
	img: InstanceType<RenderPipeline['image']>;
	width: number;
	height: number;
	revoke: () => void;
}

/**
 * Decode `bytes` into a drawable image via an object URL.
 *
 * Returns null when the image cannot be decoded, or the platform lacks a
 * piece of the pipeline — callers fall back to the original bytes (a
 * stretched cover still beats a missing one, and every failure path must
 * stay silent). The caller releases the URL through `revoke` once the
 * image has been painted.
 */
async function decodeImage(bytes: ArrayBuffer): Promise<DecodedImage | null> {
	const p = pipeline();
	if (p === null) return null;

	let objectUrl = '';
	try {
		objectUrl = p.url.createObjectURL(new p.blob([bytes]));
	} catch {
		return null;
	}
	try {
		const img = new p.image();
		await new Promise<void>((resolve, reject) => {
			img.onload = () => resolve();
			img.onerror = () => reject(new Error('image decode failed'));
			img.src = objectUrl;
		});
		const width = img.naturalWidth;
		const height = img.naturalHeight;
		if (width <= 0 || height <= 0) return null;
		return { img, width, height, revoke: () => p.url.revokeObjectURL(objectUrl) };
	} catch {
		p.url.revokeObjectURL(objectUrl);
		return null;
	}
}

/**
 * Re-encode a decoded image as a PNG of exactly `width`×`height`.
 *
 * 'cover' fills the box (aspect ignored — the `<Image>` would have
 * stretched it anyway, so the bitmap matches what would be drawn);
 * 'contain' letterboxes the image on a transparent box, keeping its
 * aspect (the `<Image>` cannot do this itself — it always stretches its
 * source to the whole box).
 *
 * Returns null when the source is no bigger than the box and the fit is
 * 'cover' (the source itself is the best copy then), or the platform
 * cannot run the pipeline.
 */
async function paintToPng(src: DecodedImage, width: number, height: number, fit: Fit): Promise<ArrayBuffer | null> {
	const p = pipeline();
	if (p === null) return null;
	if (fit === 'cover' && src.width <= width && src.height <= height) return null;

	const canvas = new p.canvas(width, height);
	const ctx = canvas.getContext('2d');
	ctx.imageSmoothingEnabled = true;
	ctx.imageSmoothingQuality = 'high';
	if (fit === 'cover') {
		ctx.drawImage(src.img, 0, 0, width, height);
	} else {
		const scale = Math.min(width / src.width, height / src.height);
		const dw = Math.max(1, Math.round(src.width * scale));
		const dh = Math.max(1, Math.round(src.height * scale));
		ctx.drawImage(src.img, (width - dw) / 2, (height - dh) / 2, dw, dh);
	}
	const blob = await canvas.convertToBlob({ type: 'image/png' });
	return await blob.arrayBuffer();
}

/**
 * Decode `bytes` and re-encode them as PNG at ≤MAX_DIM on the long edge —
 * the master copy.
 *
 * Returns null when the image is already small enough, cannot be decoded,
 * or the platform lacks a piece of the pipeline — the caller then keeps
 * the original bytes. The heavy work (decode, scale, encode) is native;
 * only the small result crosses into JS.
 */
export async function masterPng(bytes: ArrayBuffer): Promise<ArrayBuffer | null> {
	const src = await decodeImage(bytes);
	if (src === null) return null;
	try {
		if (Math.max(src.width, src.height) <= MAX_DIM) return null;
		const scale = MAX_DIM / Math.max(src.width, src.height);
		return await paintToPng(
			src,
			Math.max(1, Math.round(src.width * scale)),
			Math.max(1, Math.round(src.height * scale)),
			'cover',
		);
	} catch {
		return null;
	} finally {
		src.revoke();
	}
}

/**
 * Decode `bytes` and re-encode them as PNG of exactly `width`×`height`
 * (letterboxed when `fit` is 'contain') — the display-sized copy.
 *
 * Returns null when the source is no bigger than the box (the source
 * itself is the best copy then) or the pipeline cannot run — the caller
 * then uses the source as-is.
 */
export async function preparePng(bytes: ArrayBuffer, width: number, height: number, fit: Fit): Promise<ArrayBuffer | null> {
	const src = await decodeImage(bytes);
	if (src === null) return null;
	try {
		return await paintToPng(src, width, height, fit);
	} catch {
		return null;
	} finally {
		src.revoke();
	}
}
