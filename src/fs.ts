/**
 * The filesystem the app writes to, in one place.
 *
 * On the Switch every call goes through the runtime's `Switch` namespace
 * (`sdmc:` paths — the roms, saves, the RetroArch tree). In the browser
 * preview the same calls run against an in-memory tree, so the whole
 * download / install / sync loop can be exercised from `tools/preview`
 * (against a real RomM through the CORS proxy, or the demo catalogue)
 * without an SD card.
 *
 * Everything here is best-effort by design: a full or missing SD card
 * surfaces as `null` / a returned error at the edge, never as a crash in
 * the middle of a render.
 */

/**
 * The slice of the `Switch` namespace these helpers use (the signatures
 * mirror `@nx.js/runtime`'s declarations), so the module type-checks in
 * the browser (where there is no `Switch` global) and works on-device
 * without a cast at every call site.
 */
interface SwitchFs {
	mkdirSync?: (path: string, mode?: number) => number;
	readFileSync?: (path: string, opts?: { start?: number; end?: number }) => ArrayBuffer | null;
	writeFileSync?: (path: string, data: string | ArrayBuffer | Uint8Array) => void;
	appendFileSync?: (path: string, data: string | ArrayBuffer | Uint8Array) => void;
	readDirSync?: (path: string) => string[] | null;
	statSync?: (path: string) => { size: number; mtime: number } | null;
	removeSync?: (path: string) => void;
	renameSync?: (path: string, dest: string) => void;
	/** The async windowed read — the big-file path. */
	readFile?: (path: string, opts?: { start?: number; end?: number }) => Promise<ArrayBuffer | null>;
	/** The async directory read with file/dir flags. */
	readDir?: (path: string) => AsyncIterable<{ name: string; isFile: boolean }>;
	FileSystem?: {
		openSdmc?: () => { freeSpace?: () => bigint; totalSpace?: () => bigint };
	};
}

declare const Switch: SwitchFs | undefined;

/** True on the Switch (nx.js runtime); false in the browser preview. */
export function isSwitch(): boolean {
	return typeof Switch !== 'undefined' && Switch !== null;
}

/**
 * Normalise a byte slice to the standalone `ArrayBuffer` that both
 * `SparkMD5.ArrayBuffer.append` and the runtime's fs write functions
 * handle correctly.
 *
 * The runtime hands out typed array *views* (a body chunk is a `subarray`
 * of the socket's scratch buffer, and `readBinary` windows can be slices).
 * Consumer-side code that does `new Uint8Array(buffer)`-style reads —
 * spark-md5 3.0.2's `append` among them — silently reads the wrong bytes
 * for a view with a non-zero `byteOffset`. A view that spans its whole
 * buffer exactly can pass its buffer through as-is (zero copy); any other
 * view is copied into its own.
 */
export function standaloneBuffer(data: ArrayBuffer | Uint8Array): ArrayBuffer {
	if (data instanceof Uint8Array) {
		return data.byteOffset === 0 && data.byteLength === data.buffer.byteLength
			? (data.buffer as ArrayBuffer)
			: (data.slice().buffer as ArrayBuffer);
	}
	return data;
}

// ── the in-browser stand-in for `sdmc:` ─────────────────────────────────────

interface MemoryNode {
	/** file contents (absent for directories) */
	data?: Uint8Array;
	/** directory entries: child name → node */
	children?: Map<string, MemoryNode>;
	mtime: number;
}

/** The virtual tree, keyed by path segments from the root. */
const tree = new Map<string, MemoryNode>();

/** Split a path into its non-empty segments. */
function parts(path: string): string[] {
	return path.split('/').filter((p) => p !== '');
}

/**
 * Follow a path through the virtual tree.
 *
 * @param create when true, every missing segment becomes a directory
 *               (mirrors the runtime's parent-creating `writeFile`).
 * @returns the node at the path, or null when absent (and `create` is
 *          false) — the empty path yields the root.
 */
function walk(path: string, create: boolean): MemoryNode | null {
	const segs = parts(path);
	let node: MemoryNode | null = tree.get('') ?? null;
	if (node === null && create) {
		node = { children: new Map<string, MemoryNode>(), mtime: Date.now() };
		tree.set('', node);
	}
	for (const seg of segs) {
		if (node === null) return null;
		let child: MemoryNode | null = node.children?.get(seg) ?? null;
		if (child === null && create) {
			child = { children: new Map<string, MemoryNode>(), mtime: Date.now() };
			node.children?.set(seg, child);
		}
		if (child === null) return null;
		node = child;
	}
	return node;
}

/** Ensure the parent directory of `path` exists in the virtual tree. */
function ensureParent(path: string): void {
	walk(parts(path).slice(0, -1).join('/') || '/', true);
}

// ── the public surface ──────────────────────────────────────────────────────

/** Free space on the SD card, in bytes — or null when unknown (off-device). */
export function sdFreeSpace(): number | null {
	if (!isSwitch()) return null;
	try {
		const free = Switch!.FileSystem?.openSdmc?.()?.freeSpace?.();
		if (free === undefined || free === null) return null;
		return Number(free);
	} catch {
		return null;
	}
}

/**
 * Read a whole file (or a byte window of it).
 *
 * `opts.start` / `opts.end` select the window `[start, end)` — `end` is
 * EXCLUSIVE, mirroring the device runtime's actual behaviour: the runtime's
 * docs call `end` inclusive, but on-device `Switch.readFile` returns one
 * byte less (verified 1.0.0-beta.7: a requested 1 MiB window came back
 * 1,048,575 bytes). Callers must therefore never assume a requested window
 * size — they must advance by the length actually returned (see
 * `readBinary`'s windowed users in `hash.ts` / `romChecksum.ts`).
 *
 * @param opts.start / opts.end the window (`end` exclusive).
 * @returns the bytes, or null when the file does not exist.
 */
export async function readBinary(
	path: string,
	opts?: { start?: number; end?: number },
): Promise<ArrayBuffer | null> {
	if (isSwitch()) {
		try {
			return (await Switch!.readFile!(path, opts)) ?? null;
		} catch {
			return null;
		}
	}
	const node = walk(path, false);
	if (node?.data === undefined) return null;
	const start = Math.max(0, opts?.start ?? 0);
	// Exclusive `end`, exactly like the device runtime (see the doc above).
	const end = Math.min(node.data.length, opts?.end ?? node.data.length);
	return node.data.slice(start, end).buffer;
}

/** Write a whole file (parent directories created). */
export async function writeBinary(path: string, data: ArrayBuffer | Uint8Array): Promise<void> {
	if (isSwitch()) {
		// A standalone buffer: the runtime's write path (like spark-md5's
		// append) can mis-read a view with a non-zero byteOffset and write
		// the wrong bytes — the download-corruption class of bug.
		Switch!.writeFileSync!(path, standaloneBuffer(data));
		return;
	}
	const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
	ensureParent(path);
	const segs = parts(path);
	const dir = walk(segs.slice(0, -1).join('/') || '/', true);
	const name = segs[segs.length - 1] ?? path;
	const copy = bytes.slice();
	const existing = dir?.children?.get(name);
	if (existing !== undefined) {
		existing.data = copy;
		existing.children = undefined;
		existing.mtime = Date.now();
	} else {
		dir?.children?.set(name, { data: copy, mtime: Date.now() });
	}
}

/** Append bytes to a file (created if absent) — the streaming-write path. */
export async function appendBinary(path: string, data: ArrayBuffer | Uint8Array): Promise<void> {
	if (isSwitch()) {
		// A standalone buffer, always: the staged download chunks are
		// subarray views of the socket's scratch buffer, and a view with a
		// non-zero byteOffset written through the runtime's append can lay
		// down the wrong bytes with the right byte count — a file that
		// passes the size check and fails the hash, every time.
		Switch!.appendFileSync!(path, standaloneBuffer(data));
		return;
	}
	const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
	ensureParent(path);
	const segs = parts(path);
	const dir = walk(segs.slice(0, -1).join('/') || '/', true);
	const name = segs[segs.length - 1] ?? path;
	const prev = dir?.children?.get(name);
	const base: Uint8Array =
		prev !== undefined && prev.data !== undefined ? prev.data : new Uint8Array(0);
	const next = new Uint8Array(base.length + bytes.length);
	next.set(base, 0);
	next.set(bytes, base.length);
	const node: MemoryNode = { data: next, mtime: Date.now() };
	dir?.children?.set(name, node);
}

/** Read a file as UTF-8 text, or null when absent. */
export async function readText(path: string): Promise<string | null> {
	const buf = await readBinary(path);
	if (buf === null) return null;
	try {
		return new TextDecoder().decode(buf);
	} catch {
		return null;
	}
}

/** Write a file as UTF-8 text. */
export async function writeText(path: string, text: string): Promise<void> {
	await writeBinary(path, new TextEncoder().encode(text));
}

/**
 * Read a file synchronously as UTF-8 text — device only (the preview's
 * in-memory tree has no synchronous surface); null when absent or
 * off-device. For the tiny files a boot cannot wait on (the config).
 */
export function readTextSync(path: string): string | null {
	if (!isSwitch()) return null;
	try {
		const buf = Switch!.readFileSync!(path);
		return buf === null ? null : new TextDecoder().decode(buf);
	} catch {
		return null;
	}
}

/**
 * Write a file synchronously as UTF-8 text — device only, no-op
 * off-device. False when the write failed: the caller decides what the
 * session is worth without the file.
 */
export function writeTextSync(path: string, text: string): boolean {
	if (!isSwitch()) return false;
	try {
		Switch!.writeFileSync!(path, text);
		return true;
	} catch {
		return false;
	}
}

/** True when the path exists (file or directory). */
export async function exists(path: string): Promise<boolean> {
	if (isSwitch()) {
		try {
			return Switch!.statSync!(path) !== null;
		} catch {
			return false;
		}
	}
	return walk(path, false) !== null;
}

/** The size of a file in bytes, or -1 when it does not exist. */
export async function fileSize(path: string): Promise<number> {
	if (isSwitch()) {
		try {
			return Switch!.statSync!(path)?.size ?? -1;
		} catch {
			return -1;
		}
	}
	const node = walk(path, false);
	return node?.data !== undefined ? node.data.length : -1;
}

/**
 * The last-modified time in epoch **milliseconds**, or 0 when unknown.
 *
 * The runtime's `statSync` reports epoch *seconds* (`st_mtim.tv_sec`, see
 * its `FsFile.lastModified` multiplying by 1000); the app's contract is ms
 * everywhere (`new Date(x)`, `Date.parse` comparisons, the preview's
 * `Date.now()` nodes), so the seconds are converted here — a sync layer
 * that fed seconds to `new Date()` silently reported 1970 timestamps to
 * the server, and a 0 crossed the wire as an empty string that RomM's
 * schema rejects (422) and sank the whole negotiate.
 */
export async function fileMtime(path: string): Promise<number> {
	if (isSwitch()) {
		try {
			const m = Switch!.statSync!(path)?.mtime;
			return typeof m === 'number' && Number.isFinite(m) ? m * 1000 : 0;
		} catch {
			return 0;
		}
	}
	return walk(path, false)?.mtime ?? 0;
}

/**
 * List the entries of a directory.
 *
 * @returns `{ name, isFile }` per entry, or null when the directory does
 *          not exist (callers treat null as "nothing to see").
 */
export async function listDir(
	path: string,
): Promise<Array<{ name: string; isFile: boolean }> | null> {
	if (isSwitch()) {
		try {
			// The async readDir carries the file/dir flag; a per-entry
			// statSync would be a syscall per file (the saves directory
			// grows with the library, and the sync runs at every boot).
			const iter = Switch!.readDir?.(path);
			if (iter === undefined) return null;
			const out: Array<{ name: string; isFile: boolean }> = [];
			for await (const entry of iter) {
				out.push({ name: entry.name, isFile: entry.isFile });
			}
			return out;
		} catch {
			return null;
		}
	}
	const node = walk(path, false);
	if (node?.children === undefined) return null;
	return [...node.children.entries()].map(([name, child]) => ({
		name,
		isFile: child.data !== undefined,
	}));
}

/** Delete a file (or a directory tree). No-op when absent. */
export async function remove(path: string): Promise<void> {
	if (isSwitch()) {
		try {
			Switch!.removeSync!(path);
		} catch {
			/* absent or unremovable — either way the path is gone from our view */
		}
		return;
	}
	const segs = parts(path);
	walk(segs.slice(0, -1).join('/'), false)?.children?.delete(segs[segs.length - 1] ?? path);
}

/**
 * Move/rename a file or directory. Throws when the source is absent.
 *
 * Horizon's `renameSync` has no overwrite semantics: renaming onto an
 * existing destination fails with "File exists" (POSIX replace() is not
 * exposed). Removing the destination first gives the POSIX contract the
 * callers below expect — the old file is replaced by the new one — at
 * the cost of a wider non-atomic window than a true swap (acceptable:
 * every caller here just moved a fully-written temp file over its own
 * previous output).
 */
export async function move(src: string, dest: string): Promise<void> {
	if (isSwitch()) {
		await remove(dest);
		Switch!.renameSync!(src, dest);
		return;
	}
	const srcNode = walk(src, false);
	if (srcNode === null) throw new Error(`no such path: ${src}`);
	const destSegs = parts(dest);
	const destDir = walk(destSegs.slice(0, -1).join('/') || '/', true);
	srcNode.mtime = Date.now();
	destDir?.children?.set(destSegs[destSegs.length - 1] ?? dest, srcNode);
	const srcSegs = parts(src);
	walk(srcSegs.slice(0, -1).join('/'), false)?.children?.delete(srcSegs[srcSegs.length - 1] ?? src);
}

/** Preview-harness seam: forget the whole virtual tree. */
export function resetMemoryFs(): void {
	tree.clear();
}

/** Create a directory (best-effort; no-op when it already exists). */
export async function mkdir(path: string): Promise<void> {
	if (isSwitch()) {
		try {
			Switch!.mkdirSync!(path);
		} catch {
			/* may already exist, or the runtime creates parents on write */
		}
		return;
	}
	walk(path, true);
}
