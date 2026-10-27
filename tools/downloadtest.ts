#!/usr/bin/env node
/**
 * Offline test for the download queue's size sentinels
 * (`src/roms/download.ts`), run against the in-memory filesystem.
 *
 * The fake server mimics what RomM's nginx front actually does for a
 * single-file rom (the 5.x `FileRedirectResponse`): no Range header →
 * 200 with the whole file; `Range: bytes=N-` → 206 with
 * `content-range` over the file's ON-DISK size (which may differ from the
 * size the library record remembers — the 507 MB over 525 MB case), or
 * 416 when the range starts past the end.
 *
 * Run:
 *   npx esbuild tools/downloadtest.ts --bundle --platform=node --format=esm --outfile=/tmp/downloadtest.mjs
 *   node /tmp/downloadtest.mjs
 */
import { downloadQueue, type QueueItemView } from '../src/roms/download';
import { exists, fileSize, readBinary, resetMemoryFs, writeBinary } from '../src/fs';
import { calculateMd5 } from '../src/services/romChecksum';

let failures = 0;
function check(name: string, ok: boolean, detail = ''): void {
	if (ok) {
		console.log(`  ok    ${name}`);
	} else {
		failures += 1;
		console.log(`  FAIL  ${name}${detail !== '' ? ` — ${detail}` : ''}`);
	}
}

/** Deterministic pseudo-content: cheap, and any tampering shows in the bytes. */
function content(seed: number, size: number): Uint8Array {
	const out = new Uint8Array(size);
	for (let i = 0; i < size; i++) out[i] = (i * 31 + seed * 7) & 0xff;
	return out;
}

/** `readBinary` hands back an ArrayBuffer; compare it against expected bytes. */
function equal(buf: ArrayBuffer | null, expected: Uint8Array): boolean {
	if (buf === null) return false;
	const a = new Uint8Array(buf);
	if (a.length !== expected.length) return false;
	for (let i = 0; i < expected.length; i++) if (a[i] !== expected[i]) return false;
	return true;
}

/** Stream `bytes` as a response body, optionally cut short at `cut`. */
function streamOf(bytes: Uint8Array, cut = -1): ReadableStream<Uint8Array> {
	return new ReadableStream<Uint8Array>({
		start(controller) {
			const end = cut >= 0 ? Math.min(cut, bytes.length) : bytes.length;
			const CHUNK = 65536;
			for (let off = 0; off < end; off += CHUNK) {
				controller.enqueue(bytes.slice(off, Math.min(end, off + CHUNK)));
			}
			controller.close();
		},
	});
}

type ServerBehaviour =
	| { mode: 'nginx' } // honour Range like the real front does
	| { mode: 'bad-206' }; // claim 206 but send the WHOLE file (Range ignored)

interface FakeServer {
	file: Uint8Array;
	behaviour: ServerBehaviour;
	/**
	 * Cut the FIRST download body this short (a flaky line), then apply to
	 * nothing: the following resume answers in full. -1/absent = never cut.
	 */
	cut?: number;
	/** True once the cut has been spent. */
	cutSpent: boolean;
	/** How many times the content route was hit (downloads + probes). */
	calls: number;
	/** How many of those were full-body (non-Range) requests. */
	fullBodies: number;
}

/** One `fetchPart` bound to a fake server, the way install.ts builds it. */
function fetchPartOf(server: FakeServer) {
	return (_signal: AbortSignal, rangeStart: number): Promise<Response> => {
		server.calls += 1;
		const file = server.file;
		// A Range request (any resume, or the size probe with bytes=1-).
		if (rangeStart > 0) {
			if (server.behaviour.mode === 'bad-206') {
				// The anomaly: a 206 whose body is the whole file. The
				// content-range still names the file's real total, so the
				// queue's over-delivery sentinel is what catches it.
				server.fullBodies += 1;
				return Promise.resolve(
					new Response(streamOf(file), {
						status: 206,
						headers: {
							'content-type': 'application/octet-stream',
							'content-length': String(file.length),
							'content-range': `bytes 0-${file.length - 1}/${file.length}`,
						},
					}),
				);
			}
			if (rangeStart >= file.length) {
				return Promise.resolve(
					new Response(null, {
						status: 416,
						headers: { 'content-range': `bytes */${file.length}` },
					}),
				);
			}
			// A resume (or the size probe) is never the flaky one: the cut
			// applies to the initial full download only.
			const body = file.slice(rangeStart);
			return Promise.resolve(
				new Response(streamOf(body), {
					status: 206,
					headers: {
						'content-type': 'application/octet-stream',
						'content-length': String(body.length),
						'content-range': `bytes ${rangeStart}-${file.length - 1}/${file.length}`,
						'accept-ranges': 'bytes',
					},
				}),
			);
		}
		// No Range header: the whole file from byte 0 — the one body a
		// flaky line may cut short (the declared length is kept: a real
		// cut connection lies the same way).
		server.fullBodies += 1;
		let cut = -1;
		if (server.cut !== undefined && !server.cutSpent) {
			server.cutSpent = true;
			cut = server.cut;
		}
		return Promise.resolve(
			new Response(streamOf(file, cut), {
				status: 200,
				headers: {
					'content-type': 'application/octet-stream',
					'content-length': String(file.length),
				},
			}),
		);
	};
}

/** Queue one download and await its final status. */
async function run(
	dest: string,
	file: Uint8Array,
	recordSize: number,
	hash: string,
	behaviour: ServerBehaviour = { mode: 'nginx' },
	cut?: number,
): Promise<{ status: string; view: QueueItemView; server: FakeServer }> {
	const server: FakeServer = { file, behaviour, cut, cutSpent: false, calls: 0, fullBodies: 0 };
	const status = await downloadQueue.add({
		id: `t:${dest}`,
		kind: 'rom',
		label: `test ${dest}`,
		dest,
		size: recordSize,
		hash,
		fetchPart: fetchPartOf(server),
	});
	const view = downloadQueue.getItems().find((v) => v.dest === dest);
	return { status, view: view as QueueItemView, server };
}

const KB = 1024;
const MB = 1024 * 1024;
const WRONG_MD5 = 'ab'.repeat(16);

async function main(): Promise<void> {
	// ── 1: the reported case — the file on the server outgrew the record ──
	// The library entry lists 800 KB (a stale scan); the file nginx serves
	// is 1 MB (re-scanned / replaced since). No MD5 recorded. The download
	// must commit the 1 MB file the server actually has — and say so.
	console.log('— server file outgrew the library record (no MD5) —');
	resetMemoryFs();
	{
		const file = content(1, 1 * MB);
		const { status, view, server } = await run('sdmc:/t/d1.bin', file, 800 * KB, '');
		check('status done', status === 'done', status);
		check('file bytes are the server file', equal(await readBinary('sdmc:/t/d1.bin'), file));
		check('part renamed away', !(await exists('sdmc:/t/d1.bin.part')));
		check('queue row carries the true size', view !== undefined && view.size === file.length, String(view?.size));
		check('queue row notes the stale record', view !== undefined && view.note !== '', String(view?.note));
		check('exactly one full body (no needless refetch)', server.fullBodies === 1, String(server.fullBodies));
	}

	// ── 2: the ordinary case — sizes agree, nothing to note ────────────────
	console.log('— sizes agree (the quiet path) —');
	resetMemoryFs();
	{
		const file = content(2, 700 * KB);
		const { status, view } = await run('sdmc:/t/d2.bin', file, file.length, '');
		check('status done', status === 'done', status);
		check('no note when sizes agree', view !== undefined && view.note === '', String(view?.note));
	}

	// ── 3: the anomaly — a 206 that ignores the Range and appends ──────────
	// A 100 KB part from an earlier attempt; the "206" sends the WHOLE file.
	// Without the sentinel the part would end up 1.1 MB and commit (no MD5
	// to catch it). With it: dropped, failed, the part gone.
	console.log('— over-delivering 206 (a Range-ignoring body) —');
	resetMemoryFs();
	{
		const file = content(3, 1 * MB);
		await writeBinary('sdmc:/t/d3.bin.part', file.slice(0, 100 * KB));
		const { status, view, server } = await run(
			'sdmc:/t/d3.bin',
			file,
			file.length,
			'',
			{ mode: 'bad-206' },
		);
		check('status error', status === 'error', status);
		check('the error names the anomaly', view !== undefined && /discarded/.test(view.error), String(view?.error));
		check('the poisoned part was dropped', !(await exists('sdmc:/t/d3.bin.part')));
		check('nothing committed', !(await exists('sdmc:/t/d3.bin')));
		check('the queue shows the failure', view !== undefined && view.status === 'error');
		void server;
	}

	// ── 4: a flaky line — cut stream resumes in place ──────────────────────
	console.log('— cut stream resumes to completion —');
	resetMemoryFs();
	{
		const file = content(4, 1 * MB);
		const { status } = await run('sdmc:/t/d4.bin', file, file.length, '', { mode: 'nginx' }, 200 * KB);
		check('status done after resume', status === 'done', status);
		check('resumed bytes are intact', equal(await readBinary('sdmc:/t/d4.bin'), file));
	}

	// ── 5: an old part the server has since grown ───────────────────────────
	// The part (1 MB) matches the record (1 MB) but the server file is now
	// 1.2 MB. No MD5: the probe must see the part no longer matches the
	// server's total, drop it, and re-download.
	console.log('— stale part, the server file grew (no MD5) —');
	resetMemoryFs();
	{
		const newFile = content(5, 1_200 * KB);
		const server: FakeServer = {
			file: newFile,
			behaviour: { mode: 'nginx' },
			cutSpent: false,
			calls: 0,
			fullBodies: 0,
		};
		// The part left by the earlier (1 MB) attempt.
		await writeBinary('sdmc:/t/d5.bin.part', newFile.slice(0, 1 * MB));
		const status = await downloadQueue.add({
			id: 't:d5',
			kind: 'rom',
			label: 'test d5',
			dest: 'sdmc:/t/d5.bin',
			size: 1 * MB,
			hash: '',
			fetchPart: fetchPartOf(server),
		});
		check('status done', status === 'done', status);
		check('final file is the GROWN server file', equal(await readBinary('sdmc:/t/d5.bin'), newFile));
		const view = downloadQueue.getItems().find((v) => v.dest === 'sdmc:/t/d5.bin');
		check('queue row notes the stale record', view !== undefined && view.note !== '', String(view?.note));
		check('a full refetch happened', server.fullBodies === 1, String(server.fullBodies));
	}

	// ── 6: an old part that still matches the server — commit, no refetch ──
	console.log('— part matches the current server total (no MD5) —');
	resetMemoryFs();
	{
		const file = content(6, 1_200 * KB);
		const server: FakeServer = {
			file,
			behaviour: { mode: 'nginx' },
			cutSpent: false,
			calls: 0,
			fullBodies: 0,
		};
		// The part is the whole current file; only the record lags (1 MB).
		await writeBinary('sdmc:/t/d6.bin.part', file);
		const status = await downloadQueue.add({
			id: 't:d6',
			kind: 'rom',
			label: 'test d6',
			dest: 'sdmc:/t/d6.bin',
			size: 1 * MB,
			hash: '',
			fetchPart: fetchPartOf(server),
		});
		check('status done', status === 'done', status);
		check('committed in place, no refetch', server.fullBodies === 0 && server.calls === 1, `calls=${server.calls}`);
		check('bytes intact', equal(await readBinary('sdmc:/t/d6.bin'), file));
		const view = downloadQueue.getItems().find((v) => v.dest === 'sdmc:/t/d6.bin');
		check('row notes the stale record', view !== undefined && view.note !== '', String(view?.note));
	}

	// ── 7: an MD5 that cannot match ─────────────────────────────────────────
	console.log('— MD5 mismatch (the file changed on the server) —');
	resetMemoryFs();
	{
		const file = content(7, 500 * KB);
		const { status, view } = await run('sdmc:/t/d7.bin', file, file.length, WRONG_MD5);
		check('status error', status === 'error', status);
		check('the error is a hash mismatch', view !== undefined && /hash mismatch/.test(view.error), String(view?.error));
		check('the poisoned part was dropped', !(await exists('sdmc:/t/d7.bin.part')));
		check('nothing committed', !(await exists('sdmc:/t/d7.bin')));
	}

	// ── 8: an MD5 that matches, the size field merely stale ─────────────────
	console.log('— MD5 matches while the record size lags —');
	resetMemoryFs();
	{
		const file = content(8, 500 * KB);
		await writeBinary('sdmc:/t/d8-src.bin', file);
		const md5 = await calculateMd5('sdmc:/t/d8-src.bin');
		const { status, view } = await run('sdmc:/t/d8.bin', file, 400 * KB, md5 ?? WRONG_MD5);
		check('status done (the bytes ARE the recorded file)', status === 'done', status);
		check('row notes the size drift', view !== undefined && view.note !== '', String(view?.note));
		check('row shows the true size', view !== undefined && view.size === file.length, String(view?.size));
	}

	// ── 9: the part outgrew the server file (a 416) ─────────────────────────
	console.log('— part bigger than the server file (416) —');
	resetMemoryFs();
	{
		const file = content(9, 800 * KB); // re-imported as a smaller dump
		await writeBinary('sdmc:/t/d9.bin.part', content(9, 1 * MB)); // the old, bigger one
		const { status, view, server } = await run('sdmc:/t/d9.bin', file, 1 * MB, '');
		check('status done', status === 'done', status);
		check('final file is the smaller server file', equal(await readBinary('sdmc:/t/d9.bin'), file));
		check('the stale part was dropped', !(await exists('sdmc:/t/d9.bin.part')));
		check('a refetch from byte 0 happened', server.fullBodies === 1, String(server.fullBodies));
		void view;
	}

	// ── 10: the queue view shape the screens read ───────────────────────────
	console.log('— queue view exposes the note —');
	resetMemoryFs();
	{
		const file = content(10, 600 * KB);
		await run('sdmc:/t/d10.bin', file, 500 * KB, '');
		const view = downloadQueue.getItems().find((v) => v.dest === 'sdmc:/t/d10.bin');
		check(
			'view note is a non-empty string',
			view !== undefined && typeof view.note === 'string' && view.note !== '',
			String(view?.note),
		);
		check('view progress is 1 when done', view !== undefined && view.progress === 1, String(view?.progress));
	}
}

void main()
	.then(() => {
		downloadQueue.clearFinished();
		if (failures > 0) {
			console.log(`\n${failures} FAILURE(S)`);
			process.exit(1);
		}
		console.log('\nall download tests passed');
		process.exit(0);
	})
	.catch((err) => {
		console.error('\nunexpected error:', err);
		process.exit(1);
	});
