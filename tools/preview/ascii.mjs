/**
 * Dev-only: turn a PNG screenshot into an ASCII map so the layout can be
 * inspected from the terminal (the agent cannot view images).
 *
 * usage: node tools/preview/ascii.mjs <file.png> [cols]
 */
import { Jimp } from 'jimp';

const file = process.argv[2];
const cols = Number(process.argv[3] ?? 100);

const image = await Jimp.read(file);
const { width, height } = image;
const rows = Math.max(1, Math.round((cols * height) / width / 2.1));

image.resize({ w: cols, h: rows });

const ramp = ' .:-=+*#%@';
const buf = image.bitmap.data;

let out = '';
for (let y = 0; y < rows; y++) {
	let line = '';
	for (let x = 0; x < cols; x++) {
		const i = (y * cols + x) * 4;
		const r = buf[i];
		const g = buf[i + 1];
		const b = buf[i + 2];
		const lum = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
		line += ramp[Math.min(ramp.length - 1, Math.round(lum * (ramp.length - 1)))];
	}
	out += line + '\n';
}

console.log(`${file}: ${width}x${height} -> ${cols}x${rows}`);
console.log(out);
