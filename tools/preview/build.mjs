#!/usr/bin/env node
/**
 * Bundle the browser preview harness (dev-only, not shipped).
 *
 * The preview is the real app rendered into a <canvas> by react-tela, so
 * the bundle is built from `src/` exactly like the on-device bundle — only
 * the entry point and the JSX target differ.
 */
import { build } from 'esbuild';

await build({
	entryPoints: ['tools/preview/entry.tsx'],
	bundle: true,
	sourcemap: 'inline',
	target: 'es2022',
	format: 'iife',
	outfile: 'tools/preview/bundle.js',
	// The 7z-wasm handling the device build uses (tools/build.mjs): the
	// binary inlines, and the Emscripten glue's node-only `import("module")`
	// is externalised (it is behind an environment check, never run in a
	// browser).
	loader: {
		'.wasm': 'binary',
	},
	external: ['module'],
	jsx: 'transform',
	jsxFactory: 'React.createElement',
	jsxFragment: 'React.Fragment',
	define: {
		'process.env.NODE_ENV': '"development"',
		__ROMMMATE_BUILD__: JSON.stringify('preview'),
	},
	logLevel: 'info',
});
