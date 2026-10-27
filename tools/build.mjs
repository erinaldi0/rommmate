#!/usr/bin/env node
/**
 * Bundle the app with esbuild and stamp a build identifier into it.
 *
 * The identifier (`v0.13-<git sha>[-dirty]-<UTC timestamp>`) is shown in the
 * app header, so a screenshot is enough to tell exactly which build is
 * running on the device.
 */
import { execFileSync } from 'node:child_process';
import { build } from 'esbuild';

function sh(cmd) {
	try {
		return execFileSync('sh', ['-c', cmd], { encoding: 'utf8' }).trim();
	} catch {
		return '';
	}
}

const sha = sh('git rev-parse --short HEAD 2>/dev/null') || 'nogit';
const dirty = sh('git status --porcelain 2>/dev/null') ? '-dirty' : '';
const stamp = new Date()
	.toISOString()
	.replace(/[-:]/g, '')
	.replace(/\..+/, 'Z');

const buildId = `v0.19-${sha}${dirty}-${stamp}`;

await build({
	entryPoints: ['src/main.tsx'],
	bundle: true,
	sourcemap: true,
	sourcesContent: false,
	target: 'es2022',
	format: 'esm',
	outfile: 'romfs/main.js',
	// The 7z-wasm binary is inlined (no fetch/locateFile at runtime — the
	// home-brew NRO has no server to serve it from).
	loader: {
		'.wasm': 'binary',
	},
	 external: ['module'],
	define: {
		'process.env.NODE_ENV': '"production"',
		__ROMMMATE_BUILD__: JSON.stringify(buildId),
	},
	logLevel: 'info',
});

console.log(`build id: ${buildId}`);

// Write the nx.js runtime configuration into romfs so the packager bundles it.
// Without nxjs.ini the runtime uses defaults: application mode enables full V8
// JIT and GPU canvas, which can crash on some consoles; applet mode is jitless
// and CPU-raster, which is known stable. nxjs.ini disables JIT and caps the heap.
import { writeFileSync } from 'node:fs';
try {
	writeFileSync(
		'romfs/nxjs.ini',
		`# nx.js runtime configuration for RomMmate\n` +
		`# Tuned for stability on the Nintendo Switch\n` +
		`\n` +
		`[v8]\n` +
		`# Disable JIT compilation — matches applet mode (jitless) which is known stable\n` +
		`# Full JIT in application mode can crash on some consoles/firmware versions\n` +
		`jit = false\n` +
		`\n` +
		`[memory]\n` +
		`# Cap the V8 heap at 512 MB — application mode defaults to ~3 GiB but some\n` +
		`# consoles can't sustain that; applet mode uses ~380 MiB successfully\n` +
		`heap_limit = 512\n` +
		`\n` +
		`[renderer]\n` +
		`# CPU raster is stable; GPU canvas (WebGL2) can fail on some firmware versions\n` +
		`canvas = cpu\n`,
	);
	console.log('wrote romfs/nxjs.ini');
} catch {
	console.log('warning: could not write romfs/nxjs.ini');
}
