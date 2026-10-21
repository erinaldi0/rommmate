#!/usr/bin/env node
/**
 * Bundle the app with esbuild and stamp a build identifier into it.
 *
 * The identifier (`v0.8-<git sha>[-dirty]-<UTC timestamp>`) is shown in the
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

const buildId = `v0.8-${sha}${dirty}-${stamp}`;

await build({
	entryPoints: ['src/main.tsx'],
	bundle: true,
	sourcemap: true,
	sourcesContent: false,
	target: 'es2022',
	format: 'esm',
	outfile: 'romfs/main.js',
	define: {
		'process.env.NODE_ENV': '"production"',
		__ROMMMATE_BUILD__: JSON.stringify(buildId),
	},
	logLevel: 'info',
});

console.log(`build id: ${buildId}`);
