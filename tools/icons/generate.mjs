#!/usr/bin/env node
/**
 * Dev tool: generate the bundled platform icons from the RomM project's
 * own asset set (frontend/assets/platforms).
 *
 * RomM ships its platform artwork as `.ico` / `.svg` — two formats the
 * Switch runtime cannot decode (nx.js `Image` supports PNG / JPEG / WebP
 * via libpng/libjpeg-turbo/libwebp, and nothing else). The server-hosted
 * `icon_url` is therefore dead weight on-device: the chips strip showed
 * text-only on the console while the browser preview happily drew ICOs.
 *
 * This rasterizes the same artwork once, at build time:
 *
 *   1. downloads every platform asset (SVG preferred, ICO fallback) from
 *      the rommapp/romm GitHub repo into `tools/icons/cache/`,
 *   2. renders each one into a transparent 48×48 PNG (contain-fit, the
 *      same letterbox rule the cover pipeline bakes) with headless
 *      Chrome — the one decoder on this machine that reads both formats,
 *   3. writes `romfs/assets/platforms/<slug>.png` (the NRO embeds romfs
 *      as-is, so the app gets the icons for free, offline), and
 *   4. writes `src/platform-icons.generated.ts`, the slug manifest the
 *      runtime resolves against (and the platform ATTRIBUTIONS file —
 *      the artwork is CC BY 4.0, mostly Libretro's set).
 *
 * usage: node tools/icons/generate.mjs [--size=48] [--force]
 *   --force   re-rasterize even when the PNG already exists
 *             (sources are still downloaded only when missing)
 */
import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync, existsSync, createWriteStream } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';

const REPO = 'rommapp/romm';
const BRANCH = 'master';
const DIR = 'frontend/assets/platforms';
const RAW = `https://raw.githubusercontent.com/${REPO}/${BRANCH}/${DIR}`;
const LIST_URL = `https://api.github.com/repos/${REPO}/contents/${DIR}`;

const args = process.argv.slice(2);
const size = Number(args.find((a) => a.startsWith('--size='))?.slice(7) ?? 48);
const force = args.includes('--force');

const CACHE_DIR = 'tools/icons/cache';
const OUT_DIR = 'romfs/assets/platforms';
const GENERATED_TS = 'src/platform-icons.generated.ts';

/** Same slug sanitisation the runtime applies (see `src/platform-icons.ts`). */
function sanitize(slug) {
	return slug.replace(/[^a-zA-Z0-9._-]+/g, '-');
}

async function fetchJson(url) {
	const res = await fetch(url);
	if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
	return await res.json();
}

async function download(url, dest) {
	if (existsSync(dest)) return; // the cache is the point
	const res = await fetch(url);
	if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
	await pipeline(Readable.fromWeb(res.body), createWriteStream(dest));
}

// ── 1. the source list ────────────────────────────────────────────────────
console.log(`listing ${LIST_URL} …`);
const entries = await fetchJson(LIST_URL);
const files = entries.filter((f) => f.name.endsWith('.svg') || f.name.endsWith('.ico'));
const bySlug = new Map(); // slug → ordered candidate extensions (svg first)
for (const f of files) {
	const slug = f.name.slice(0, -(f.name.length - f.name.lastIndexOf('.')));
	const ext = f.name.slice(f.name.lastIndexOf('.') + 1);
	if (!bySlug.has(slug)) bySlug.set(slug, []);
	bySlug.get(slug).push(ext);
}
console.log(`${bySlug.size} platform slugs (${files.length} source files)`);

// ── 2. download the sources ────────────────────────────────────────────────
mkdirSync(CACHE_DIR, { recursive: true });
mkdirSync(OUT_DIR, { recursive: true });
const jobs = [];
for (const [slug, exts] of bySlug) {
	for (const ext of exts) {
		const name = `${slug}.${ext}`;
		await download(`${RAW}/${encodeURIComponent(name)}`, `${CACHE_DIR}/${name}`).catch((err) =>
			console.warn(`  ! download ${name}: ${err.message}`),
		);
	}
	const candidates = exts.filter((ext) => existsSync(`${CACHE_DIR}/${slug}.${ext}`));
	if (candidates.length > 0) jobs.push({ slug, srcs: candidates.map((e) => `/cache/${encodeURIComponent(`${slug}.${e}`)}`) });
}
console.log(`${jobs.length} slugs with downloadable sources`);

// The jobs that still need rasterizing.
const todo = force ? jobs : jobs.filter((j) => !existsSync(`${OUT_DIR}/${sanitize(j.slug)}.png`));
console.log(`${todo.length} to rasterize (size ${size}×${size})`);

// ── 3. the rasterizer ─────────────────────────────────────────────────────
// A tiny local server: it serves the cache, hands the page its job list,
// and receives the rendered PNGs. No CDP — the page POSTs everything back.
const PORT = 8961;
const results = new Map(); // slug → { ok, data?, error? }
let done = false;

const http = await import('node:http');
const srv = http.createServer((req, res) => {
	const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
	if (url.pathname === '/jobs.json') {
		res.setHeader('content-type', 'application/json');
		res.end(JSON.stringify(todo.map(({ slug, srcs }) => ({ slug, srcs }))));
		return;
	}
	if (url.pathname === '/result' || url.pathname === '/done') {
		let body = '';
		req.on('data', (c) => (body += c));
		req.on('end', () => {
			if (url.pathname === '/done') {
				done = true;
			} else {
				try {
					const r = JSON.parse(body);
					results.set(r.slug, r);
					if (results.size % 25 === 0) console.log(`  … ${results.size}/${todo.length}`);
				} catch {
					/* ignore malformed */
				}
			}
			res.end('ok');
		});
		return;
	}
	// The rasterizer page itself.
	if (url.pathname === '/' || url.pathname === '/index.html') {
		res.setHeader('content-type', 'text/html');
		res.end(RASTERIZER_HTML.replaceAll('__SIZE__', String(size)));
		return;
	}
	// The cached source files.
	const file = decodeURIComponent(url.pathname).replace(/^\/cache\//, '');
	if (!/^[\w. -]+$/.test(file) || !existsSync(`${CACHE_DIR}/${file}`)) {
		res.statusCode = 404;
		res.end('nope');
		return;
	}
	res.setHeader('content-type', file.endsWith('.svg') ? 'image/svg+xml' : 'image/x-icon');
	res.end(readFileSync(`${CACHE_DIR}/${file}`));
});
await new Promise((r) => srv.listen(PORT, '127.0.0.1', r));

/** The page Chrome loads: rasterize every job and POST the PNGs back. */
const RASTERIZER_HTML = `<!doctype html>
<body>
<script type="module">
const SIZE = __SIZE__;
const jobs = await (await fetch('/jobs.json')).json();

function load(src) {
	return new Promise((resolve, reject) => {
		const img = new Image();
		img.onload = () => {
			if (!img.naturalWidth || !img.naturalHeight) reject(new Error('zero-sized'));
			else resolve(img);
		};
		img.onerror = () => reject(new Error('decode failed'));
		img.src = src;
	});
}

function rasterize(img) {
	const canvas = document.createElement('canvas');
	canvas.width = SIZE;
	canvas.height = SIZE;
	const ctx = canvas.getContext('2d');
	ctx.imageSmoothingEnabled = true;
	ctx.imageSmoothingQuality = 'high';
	// Contain-fit onto a transparent box — the same letterbox the cover
	// pipeline bakes into its display copies.
	const scale = Math.min(SIZE / img.naturalWidth, SIZE / img.naturalHeight);
	const dw = Math.max(1, Math.round(img.naturalWidth * scale));
	const dh = Math.max(1, Math.round(img.naturalHeight * scale));
	ctx.drawImage(img, (SIZE - dw) / 2, (SIZE - dh) / 2, dw, dh);
	return canvas.toDataURL('image/png');
}

for (const job of jobs) {
	let out = null;
	let err = '';
	for (const src of job.srcs) {
		try {
			out = rasterize(await load(src));
			break;
		} catch (e) {
			err = String(e);
		}
	}
	await fetch('/result', {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify(out ? { slug: job.slug, ok: true, data: out } : { slug: job.slug, ok: false, error: err }),
	});
}
await fetch('/done', { method: 'POST' });
</script>
`;

if (todo.length > 0) {
	const chrome = spawn(
		'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
		['--headless', '--disable-gpu', '--no-sandbox', `--window-size=400,300`, `http://127.0.0.1:${PORT}/`],
		{ stdio: 'ignore' },
	);
	// The page drives itself; wait for its /done (with a generous ceiling —
	// a slow machine decodes ~200 icons at its own pace).
	for (let i = 0; i < 600 && !done; i++) await sleep(500);
	chrome.kill('SIGKILL');
	console.log(`rasterized ${results.size}/${todo.length}`);
}

// ── 4. write the PNGs ─────────────────────────────────────────────────────
const written = [];
const failures = [];
for (const { slug } of jobs) {
	const file = results.get(slug);
	if (file === undefined) {
		// Nothing to do this run — the PNG already exists (--force off).
		if (existsSync(`${OUT_DIR}/${sanitize(slug)}.png`)) written.push(slug);
		else failures.push(`${slug}: skipped (no result)`);
		continue;
	}
	if (!file.ok) {
		failures.push(`${slug}: ${file.error}`);
		continue;
	}
	const b64 = file.data.slice(file.data.indexOf(',') + 1);
	writeFileSync(`${OUT_DIR}/${sanitize(slug)}.png`, Buffer.from(b64, 'base64'));
	written.push(slug);
}

// ── 5. the manifest the runtime resolves against ──────────────────────────
const slugs = [...new Set(written.map(sanitize))].sort();
const ts = `/**
 * The bundled platform icons' slug manifest — GENERATED by
 * tools/icons/generate.mjs from the RomM project's own platform artwork
 * (frontend/assets/platforms; CC BY 4.0, mostly the Libretro set — see
 * romfs/assets/platforms/ATTRIBUTIONS). Do not edit by hand: re-run the
 * generator instead.
 *
 * Every slug here has a \`romfs:/assets/platforms/<slug>.png\` beside this
 * manifest (a transparent ${size}×${size} contain-fit raster), and the app
 * resolves a platform's icon against this list — unknown slugs fall back
 * to 'default', which is itself in the set.
 */
export const PLATFORM_ICON_SLUGS: readonly string[] = [
${slugs.map((s) => `\t${JSON.stringify(s)},`).join('\n')}
];
`;
writeFileSync(GENERATED_TS, ts);

// ── 6. attributions (the artwork is CC BY 4.0) ────────────────────────────
await download(`${RAW}/ATTRIBUTIONS`, `${OUT_DIR}/ATTRIBUTIONS`).catch((err) =>
	console.warn(`  ! ATTRIBUTIONS: ${err.message}`),
);

srv.close();
console.log(`\nwrote ${written.length} icons -> ${OUT_DIR}`);
console.log(`wrote ${slugs.length} slugs -> ${GENERATED_TS}`);
if (failures.length > 0) {
	console.warn(`\nfailures (${failures.length}):`);
	for (const f of failures) console.warn(`  ${f}`);
	process.exitCode = 1;
}
