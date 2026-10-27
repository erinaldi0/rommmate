/**
 * Extracting a `.7z` archive with 7-Zip compiled to WebAssembly
 * (`7z-wasm` — the real p7zip behind 7-Zip's own `7zz` CLI).
 *
 * nx.js runs V8, and V8 speaks WebAssembly, so this works both in the
 * browser preview and on-device. The runtime has no filesystem the wasm
 * module knows about, so everything goes through its in-memory FS:
 *
 *   sdmc (windowed reads) ──► wasm MEMFS `/archive.7z`
 *                                  │ callMain(['e', '-o/.out', …])
 *                                  ▼
 *   extracted members in `/ .out` ◄──► writeBinary back to the sdmc path
 *
 * Two deliberate choices keep memory sane (the heap is a few GB at best):
 * the archive is *streamed* into MEMFS in 1 MiB windows (never whole in
 * the JS heap), and `7z e` extracts flat, so only the members asked for
 * (the loader NRO, the icon) ever materialise. A fresh module instance is
 * created per call — `callMain` runs `_main` once and then exits the
 * runtime, so a module cannot be re-driven — which also frees the
 * hundreds of MB of wasm memory when the extraction promise settles.
 */

import init7z from '7z-wasm/7zz.es6.js';
// esbuild's `binary` loader (see tools/build.mjs) inlines the wasm into
// the bundle, so no fetch/locateFile is ever needed at runtime.
import wasmBinary from '7z-wasm/7zz.wasm';
import { readBinary } from '../fs';

/** One extracted member: its flat name in the archive and its bytes. */
export interface SevenZipMember {
	name: string;
	data: Uint8Array;
}

/** What the 7z output lines saw (logging sanity when an extraction fails). */
export type SevenZipLog = (line: string) => void;

interface AnyModule {
	FS: {
		mkdir(path: string): unknown;
		readdir(path: string): string[];
		open(path: string, flags: string): { position?: number };
		write(stream: unknown, buffer: Uint8Array, offset: number, length: number, position: number): number;
		read(stream: unknown, buffer: Uint8Array, offset: number, length: number, position: number): number;
		close(stream: unknown): void;
		stat(path: string): { size: number };
		readFile(path: string): Uint8Array;
	};
	callMain(args: string[]): number;
}

/** The module factory as the es6 glue exposes it (typed loosely here). */
const init = init7z as unknown as (opts: Record<string, unknown>) => Promise<AnyModule>;

/**
 * How much of the archive to read per window: 1 MiB matches the rest of
 * the app's big-file paths, and devices handle it without pressure.
 */
const WINDOW = 1024 * 1024;

/**
 * Extract members matching `patterns` from the archive at `archivePath`
 * (an `sdmc:`-style path), returning each match's bytes.
 *
 * `7z e` extracts flat — no directory repair needed. Patterns are 7-Zip
 * wildcards against inner paths.
 *
 * @returns the extracted members (possibly empty when nothing matched).
 */
export async function sevenZipExtract(
	archivePath: string,
	patterns: string[],
	log?: SevenZipLog,
): Promise<SevenZipMember[]> {
	const printLines: string[] = [];
	const print = (line: string): void => {
		printLines.push(line);
		log?.(line);
	};

	const m = await init({
		wasmBinary,
		// The Emscripten glue tries to run _main at boot with no args
		// (a usage banner exit): hold it until callMain drives it.
		noInitialRun: true,
		noFSInit: true,
		// print/printErr feed both the collected log and the app's log.
		print,
		printErr: print,
		// No TTY involvement: stderr/stdout travel through print above.
		stdin: () => 0,
	});

	// The archive into wasm MEMFS, window by window. Never whole in the
	// JS heap: 1 MiB windows from the SD file, written at their offset.
	m.FS.mkdir('/in');
	let stream: unknown;
	let offset = 0;
	for (;;) {
		const buf = await readBinary(archivePath, { start: offset, end: offset + WINDOW });
		if (buf === null) {
			if (offset === 0) throw new Error('the downloaded 7z archive is unreadable');
			break;
		}
		const chunk = new Uint8Array(buf);
		if (chunk.length === 0) break;
		if (stream === undefined) {
			stream = m.FS.open('/in/archive.7z', 'w+');
		}
		m.FS.write(stream, chunk, 0, chunk.length, offset);
		offset += chunk.length;
		if (chunk.length < WINDOW) break;
	}
	if (stream === undefined) throw new Error('the downloaded 7z archive is empty');

	// One callMain — the runtime exits after _main returns, so every
	// pattern must go through a single invocation. `-r` walks the archive's
	// inner directories (a bare-name wildcard does not cross separators),
	// so nested members match by file name alone.
	m.FS.mkdir('/out');
	const ret = m.callMain(['e', '-r', '-o/out', '-y', '/in/archive.7z', ...patterns]);
	if (ret !== 0 && log !== undefined) log(`7zz exited with code ${ret}`);

	// Read every flat member out of /out — FS.readFile returns a fresh
	// Uint8Array per file, so the members survive the module teardown.
	const members: SevenZipMember[] = [];
	for (const name of m.FS.readdir('/out')) {
		if (name === '.' || name === '..') continue;
		members.push({ name, data: m.FS.readFile(`/out/${name}`) });
	}
	return members;
}
