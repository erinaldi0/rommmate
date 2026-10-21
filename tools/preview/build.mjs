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
	jsx: 'transform',
	jsxFactory: 'React.createElement',
	jsxFragment: 'React.Fragment',
	define: {
		'process.env.NODE_ENV': '"development"',
		__ROMMMATE_BUILD__: JSON.stringify('preview'),
	},
	logLevel: 'info',
});
