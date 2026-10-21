/**
 * Dev-only: sample colours at given coordinates in a PNG screenshot.
 *
 * usage: node tools/preview/probe.mjs <file.png> x,y [x,y …]
 *        node tools/preview/probe.mjs <file.png> --row y x0 x1 [x2 …]
 *        node tools/preview/probe.mjs <file.png> --runs y[,y…] <#rrggbb>
 *
 * `--runs` lists the horizontal runs of (roughly) one colour, which is how
 * a row of chips or a focus ring is located without looking at the image.
 */
import { Jimp } from 'jimp';

const file = process.argv[2];
const args = process.argv.slice(3);

const image = await Jimp.read(file);
const { width, height } = image;
const buf = image.bitmap.data;

const hex = (x, y) => {
	const i = (y * width + x) * 4;
	const [r, g, b] = [buf[i], buf[i + 1], buf[i + 2]];
	return `#${[r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
};

console.log(`${file}: ${width}x${height}`);

if (args[0] === '--runs') {
	const rows = args[1].split(',').map(Number);
	const target = args[2].replace('#', '');
	const rgb = [0, 2, 4].map((i) => parseInt(target.slice(i, i + 2), 16));
	for (const y of rows) {
		const runs = [];
		let start = -1;
		for (let x = 0; x < width; x++) {
			const i = (y * width + x) * 4;
			const match =
				Math.abs(buf[i] - rgb[0]) < 12 &&
				Math.abs(buf[i + 1] - rgb[1]) < 12 &&
				Math.abs(buf[i + 2] - rgb[2]) < 12;
			if (match && start < 0) start = x;
			if (!match && start >= 0) {
				runs.push(`${start}-${x - 1}`);
				start = -1;
			}
		}
		if (start >= 0) runs.push(`${start}-${width - 1}`);
		console.log(`  y=${y} ${args[2]}: ${runs.join(' ') || '(none)'}`);
	}
} else if (args[0] === '--row') {
	const y = Number(args[1]);
	const xs = args.slice(2).map(Number);
	for (const x of xs) console.log(`  (${x}, ${y}) = ${hex(x, y)}`);
} else {
	for (const pair of args) {
		const [x, y] = pair.split(',').map(Number);
		console.log(`  (${x}, ${y}) = ${hex(x, y)}`);
	}
}
