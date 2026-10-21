/**
 * Dev-only: report the horizontal bands of non-background content in a PNG
 * screenshot, so the layout can be verified from the terminal (the agent
 * cannot view images).
 *
 * usage: node tools/preview/bands.mjs <file.png> [threshold]
 *
 * A "band" is a contiguous run of rows that contain pixels brighter than the
 * threshold. For each band the x-extent of the bright pixels is printed.
 */
import { Jimp } from 'jimp';

const file = process.argv[2];
const threshold = Number(process.argv[3] ?? 60);

const image = await Jimp.read(file);
const { width, height } = image;
const buf = image.bitmap.data;

const rowInfo = [];
for (let y = 0; y < height; y++) {
	let minX = -1;
	let maxX = -1;
	let count = 0;
	for (let x = 0; x < width; x++) {
		const i = (y * width + x) * 4;
		const lum = 0.2126 * buf[i] + 0.7152 * buf[i + 1] + 0.0722 * buf[i + 2];
		if (lum > threshold) {
			if (minX < 0) minX = x;
			maxX = x;
			count++;
		}
	}
	rowInfo.push({ minX, maxX, count });
}

// Group contiguous non-empty rows into bands.
const bands = [];
let current = null;
for (let y = 0; y < height; y++) {
	const r = rowInfo[y];
	if (r.count > 0) {
		if (!current) current = { y0: y, y1: y, minX: r.minX, maxX: r.maxX, count: 0 };
		current.y1 = y;
		current.minX = current.minX < 0 ? r.minX : Math.min(current.minX, r.minX);
		current.maxX = Math.max(current.maxX, r.maxX);
		current.count += r.count;
	} else if (current) {
		bands.push(current);
		current = null;
	}
}
if (current) bands.push(current);

console.log(`${file}: ${width}x${height} (threshold ${threshold})`);
for (const b of bands) {
	console.log(
		`  y ${String(b.y0).padStart(4)}..${String(b.y1).padStart(4)}  x ${String(b.minX).padStart(4)}..${String(
			b.maxX,
		).padStart(4)}  px ${b.count}`,
	);
}
