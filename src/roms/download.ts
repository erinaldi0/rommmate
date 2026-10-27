/**
 * The download queue: everything the Play feature pulls from the server —
 * the RetroArch loader, cores, BIOS, roms — goes through here.
 *
 * One transfer at a time, streamed end to end:
 *
 *   server ─fetch (Range-resumable)─► res.body chunks ─► <dest>.part
 *                                            │
 *                       └─ MD5-verify the finished part ─► rename <dest>
 *
 * Nothing is ever held in the (32-bit) V8 heap whole: the response is
 * consumed in chunks and appended to the `.part` file, and the final hash
 * is computed by re-reading the file in 1 MiB windows. A transfer that
 * dies mid-stream keeps its `.part`, and the next attempt resumes with a
 * `Range:` header instead of starting over — matters for multi-hundred-MB
 * roms on a flaky home Wi-Fi. A stream that ends *short* of its declared
 * size is re-fetched from where it stopped within the same attempt, so a
 * single connection blip does not burn a full re-download.
 *
 * Two size sentinels guard the finish, because the MD5 is often absent and
 * a wrong file must never commit silently: the part may not exceed the
 * total the server vouches for for the bytes it sent (an over-delivering
 * stream drops the part), and a finished part whose size differs from the
 * size the library recorded is committed with a visible note — the file
 * the server actually has wins, and the stale entry is pointed at instead
 * of the mismatch going unmentioned.
 *
 * The queue is a process-wide singleton the install card's progress bar reads
 * through (via the play service). It no longer feeds the top-right badge: the
 * bar and the badge used to stack in the same corner and read as one control.
 */
import { appendBinary, exists, fileSize, move, remove, sdFreeSpace } from '../fs';
import { verifyMd5 } from '../services/romChecksum';
import { log } from '../log';

/** What the file is for (the badge and the manifest key on it). */
export type DownloadKind = 'emulator' | 'core' | 'bios' | 'rom';

export type DownloadStatus = 'queued' | 'running' | 'done' | 'error' | 'cancelled';

/**
 * One queued transfer.
 *
 * `fetchPart` is the seam to the network layer: the creator (install /
 * emulator / bios) hands the queue a function bound to *its* RommClient,
 * so the transfer gets the client's bearer token and one-shot 401 refresh
 * for free, and the queue never needs to know about auth.
 */
export interface DownloadItem {
	id: string;
	kind: DownloadKind;
	/** Human label for the badge and the queue screen. */
	label: string;
	/** The final `sdmc:` path the file ends up at. */
	dest: string;
	/** Expected size in bytes (0 when the server did not report one). */
	size: number;
	/** Expected MD5 of the finished file ('' = do not verify). */
	hash: string;
	/** Fetch one attempt: `rangeStart` > 0 sends a Range header. */
	fetchPart: (signal: AbortSignal, rangeStart: number) => Promise<Response>;
	status: DownloadStatus;
	/** Bytes written in the current (or completed) attempt. */
	transferred: number;
	/** Human explanation of the last failure, when status is 'error'. */
	error: string;
	/**
	 * A non-fatal observation from the finished transfer (e.g. the file the
	 * server sent is bigger than the library entry says) — surfaced on the
	 * queue row and the install card, where a bare "done" would hide it.
	 * Absent = nothing to say.
	 */
	note?: string;
	/** Called with the final status once the item is done (bookkeeping). */
	onDone?: (status: DownloadStatus) => void;
	/**
	 * The promise `add()` returned for this item (queue-internal: lets a
	 * second `add()` of the same path join the in-flight transfer).
	 */
	promise?: Promise<DownloadStatus>;
	/** 'downloading' while streaming, 'verifying' while the finish hash runs. */
	phase: 'downloading' | 'verifying';
	/** 0..1 during verification; the bar's source then. */
	verifyProgress: number;
}

/** How often the queue views (the bars) are refreshed while a transfer runs. */
const EMIT_STEP_MS = 250;

/**
 * How many times one attempt re-fetches the tail when the stream ends short.
 * A stream that stops before its declared size means the connection was cut
 * (a Wi-Fi blip, a router/proxy idle timeout mid-transfer) — the part on
 * disk is intact up to where it reached, so the fix is to resume from there
 * with a `Range:` request, not to start the multi-hundred-MB file over.
 */
const MAX_RESUMES = 3;

/** Pause between a truncated stream and its resume (give the line to settle). */
const RESUME_DELAY_MS = 500;

/** Join staged stream chunks into one buffer for a single SD write. */
function concatChunks(parts: Uint8Array[]): Uint8Array {
	let total = 0;
	for (const p of parts) total += p.length;
	const out = new Uint8Array(total);
	let offset = 0;
	for (const p of parts) {
		out.set(p, offset);
		offset += p.length;
	}
	return out;
}

/**
 * The file's total size as the server declared it for THIS response, or -1
 * when it stayed silent.
 *
 * `content-range` wins (a 206: `bytes <start>-<end>` over the total — the
 * total is the file's size *on disk*, which the server stats when it serves
 * it, so it can differ from the size the library record remembers; a 416
 * reports the same total). `content-length` stands in (the whole file for a
 * 200, the remainder for a 206 — hence the `rangeStart` argument).
 *
 * This is the one size the server vouches for the bytes it is actually
 * sending. The library record (`item.size`) is whatever the server reported
 * at the last scan, which the file on disk may have outgrown since — the
 * 507 MB record over a 525 MB file is exactly how a "download" ended up
 * bigger than anything the app ever mentioned.
 */
function serverTotalFrom(res: Response, rangeStart: number): number {
	const cr = res.headers.get('content-range');
	if (cr !== null) {
		const m = cr.match(/\/\s*(\d+)\s*$/);
		if (m !== null) {
			const n = Number(m[1]);
			if (Number.isFinite(n) && n >= 0) return n;
		}
	}
	const len = res.headers.get('content-length');
	if (len !== null) {
		const n = Number(len);
		if (Number.isFinite(n) && n >= 0) return res.status === 206 ? rangeStart + n : n;
	}
	return -1;
}

/** Human byte sizes for the queue's own messages (the screens format their own). */
function humanBytes(bytes: number): string {
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
	if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
	return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

/**
 * A one-item view for the UI: the mutable item plus its completion, so
 * the queue screen can paint a progress bar without reading internals.
 */
export interface QueueItemView {
	id: string;
	kind: DownloadKind;
	label: string;
	dest: string;
	size: number;
	transferred: number;
	status: DownloadStatus;
	error: string;
	/** Non-fatal observation to show on a done row ('' = none). */
	note: string;
	/** 0..1 while running, 1 when done, 0 otherwise. */
	progress: number;
	/** 'downloading' while streaming, 'verifying' while the finish hash runs. */
	phase: 'downloading' | 'verifying';
	/** 0..1 during verification; the bar's source then. */
	verifyProgress: number;
}

class DownloadQueue {
	#items: DownloadItem[] = [];
	/** Re-entrancy guard: the pump never overlaps itself. */
	#pumping = false;
	/** The aborter of the in-flight transfer, if any. */
	#running: { item: DownloadItem; controller: AbortController } | null = null;

	#listeners = new Set<() => void>();
	#views: QueueItemView[] = [];

	#emit(): void {
		this.#views = this.#items.map((item) => ({
			id: item.id,
			kind: item.kind,
			label: item.label,
			dest: item.dest,
			size: item.size,
			transferred: item.transferred,
			status: item.status,
			error: item.error,
			note: item.note ?? '',
			progress:
				item.status === 'done'
					? 1
					: item.status === 'running' && item.size > 0
						? item.phase === 'verifying'
							? item.verifyProgress
							: Math.min(1, item.transferred / item.size)
						: 0,
			phase: item.phase,
			verifyProgress: item.verifyProgress,
		}));
		for (const listener of this.#listeners) listener();
	}

	/** Subscribe to queue changes (the queue screen + the badge). */
	subscribe(listener: () => void): () => void {
		this.#listeners.add(listener);
		return () => {
			this.#listeners.delete(listener);
		};
	}

	/** The current items, as a stable snapshot. */
	getItems(): QueueItemView[] {
		return this.#views;
	}

	/** True when anything in the queue is still queued or running. */
	get busy(): boolean {
		return this.#items.some((i) => i.status === 'queued' || i.status === 'running');
	}

	/**
	 * Queue a transfer. Duplicate `dest` paths are replaced (a new attempt
	 * of the same file), so re-pressing "install" never stacks two
	 * downloads of the same file.
	 *
	 * @returns a promise resolving with the final status, so callers that
	 *          must act on the finished file (extracting a loader zip,
	 *          updating the manifest) can simply await it.
	 */
	add(
		item: Omit<
			DownloadItem,
			'status' | 'transferred' | 'error' | 'phase' | 'verifyProgress'
		>,
	): Promise<DownloadStatus> {
		// The same file is already queued or in flight: join that transfer
		// instead of stacking a duplicate of it.
		const inFlight = this.#items.find(
			(i) => i.dest === item.dest && (i.status === 'queued' || i.status === 'running'),
		);
		if (inFlight !== undefined) {
			return inFlight.promise ?? Promise.resolve(inFlight.status);
		}

		let resolveDone: (status: DownloadStatus) => void = () => {};
		const promise = new Promise<DownloadStatus>((resolve) => {
			resolveDone = resolve;
		});
		const creatorOnDone = item.onDone;
		// A finished item with the same path (a stale result) is replaced.
		this.#items = this.#items.filter((i) => i.dest !== item.dest);
		const entry: DownloadItem = {
			...item,
			status: 'queued',
			transferred: 0,
			error: '',
			phase: 'downloading',
			verifyProgress: 0,
			promise,
			onDone: (status) => {
				resolveDone(status);
				creatorOnDone?.(status);
			},
		};
		this.#items.push(entry);
		this.#emit();
		this.#pump();
		return promise;
	}

	/**
	 * Cancel a queued item, or abort a running one (its `.part` survives for
	 * a later resume). An item that has already settled (done / error /
	 * cancelled) is simply removed from the list — this makes the queue
	 * screen's A do the one intuitive thing on every row: dismiss it.
	 */
	cancel(id: string): void {
		const item = this.#items.find((i) => i.id === id);
		if (item === undefined) return;
		if (item.status === 'done' || item.status === 'error' || item.status === 'cancelled') {
			this.#items = this.#items.filter((i) => i.id !== id);
			this.#emit();
			return;
		}
		if (item.status === 'queued') {
			this.#items = this.#items.filter((i) => i.id !== id);
			item.onDone?.('cancelled');
			this.#emit();
			return;
		}
		if (this.#running !== null && this.#running.item.id === id) {
			this.#running.controller.abort();
		}
	}

	/** Remove finished items (the "clear" on the queue screen). */
	clearFinished(): void {
		this.#items = this.#items.filter((i) => i.status === 'queued' || i.status === 'running');
		this.#emit();
	}

	/**
	 * Run the queue: take the next queued item, transfer it, then loop.
	 * A dead transfer never stops the pump — the error is recorded on the
	 * item and the next one runs.
	 */
	#pump(): void {
		if (this.#pumping) return;
		this.#pumping = true;
		void (async () => {
			try {
				for (;;) {
					if (this.#running !== null) {
						// Something else is in flight — wait for the pump's
						// own item to finish below instead of racing it.
						break;
					}
					const item = this.#items.find((i) => i.status === 'queued');
					if (item === undefined) break;
					item.status = 'running';
					item.transferred = 0;
					item.error = '';
					this.#emit();
					const status = await this.#run(item);
					// `#run` cleared `#running` in its finally; record the
					// outcome and hand the item to its creator.
					item.status = status;
					item.onDone?.(status);
					this.#emit();
				}
			} finally {
				this.#pumping = false;
				if (this.#running !== null || this.#items.some((i) => i.status === 'queued')) {
					// More work arrived while we were running it: loop again.
					this.#pump();
				}
			}
		})();
	}

	/** Commit the finished part to its final path (replacing any old copy). */
	async #commit(item: DownloadItem, part: string): Promise<void> {
		if (await exists(item.dest)) await remove(item.dest);
		await move(part, item.dest);
		log('download', `ok ${item.label} → ${item.dest}`);
	}

	/**
	 * Blocking MD5 verify of the finished `.part`. Sets the `verifying`
	 * phase and streams progress back to the queue views.
	 *
	 * Returns a verdict and never commits anything itself:
	 * - 'match'      — the part is good; the caller renames it into place.
	 * - 'mismatch'   — the part's bytes are wrong: it is REMOVED here (a
	 *                  wrong part is resume poison — every later attempt
	 *                  would append onto or re-verify the same bad bytes
	 *                  and fail forever).
	 * - 'unreadable' — the part could not be read to hash at all; it is
	 *                  kept (the failure may be transient, and the bytes
	 *                  already on disk are still valid resume material).
	 */
	async #verifyPart(
		item: DownloadItem,
		part: string,
	): Promise<'match' | 'mismatch' | 'unreadable'> {
		if (item.hash === '') return 'match';
		item.phase = 'verifying';
		item.verifyProgress = 0;
		this.#emit();

		let lastEmitAt = 0;
		try {
			const result = await verifyMd5(part, item.hash, (p) => {
				item.verifyProgress = p.percent / 100;
				const now = Date.now();
				if (now - lastEmitAt > EMIT_STEP_MS) {
					lastEmitAt = now;
					this.#emit();
				}
			});

			if (result.matches) {
				log('download', `verified ${item.label} md5 ${result.actual}`);
				return 'match';
			}

			const size = await fileSize(part);
			const sizeNote = item.size > 0 && size !== item.size ? `; ${size}/${item.size} bytes` : '';
			log(
				'error',
				`download ${item.label}: md5 mismatch — expected ${result.expected}, got ${result.actual}${sizeNote}`,
			);
			// The part's bytes are wrong: drop it, or every future attempt
			// resumes onto (or re-verifies) the same corruption.
			await remove(part);
			return 'mismatch';
		} catch (err) {
			log('error', `download ${item.label}: could not verify — ${String(err)}`);
			return 'unreadable';
		} finally {
			item.phase = 'downloading';
			item.verifyProgress = 0;
			this.#emit();
		}
	}

	/**
	 * Ask the server for the CURRENT total size of the item's file, or null
	 * when it cannot be established (offline, an unexpected answer).
	 *
	 * One small request — `Range: bytes=1-` — of which only the headers are
	 * read: the total arrives in `content-range` (a 206) or
	 * `content-length` (a 200), and the body is discarded at once. This is
	 * how a `.part` left by an earlier attempt is vetted when the file has
	 * no MD5 to verify it with: the part must be exactly the server's
	 * current file size to be trusted — a part that is bigger (the file was
	 * replaced by a smaller one) or smaller (it grew) no longer matches
	 * what the server describes, and committing it would install a file
	 * nothing on the server vouches for.
	 */
	async #probeServerTotal(item: DownloadItem, signal: AbortSignal): Promise<number | null> {
		const probe = new AbortController();
		const followAbort = (): void => probe.abort();
		signal.addEventListener('abort', followAbort, { once: true });
		try {
			const res = await item.fetchPart(probe.signal, 1);
			const total = serverTotalFrom(res, res.status === 206 ? 1 : 0);
			try {
				const reader = res.body?.getReader();
				if (reader !== undefined) await reader.cancel();
			} catch {
				/* the abort below releases the connection either way */
			}
			return total >= 0 ? total : null;
		} catch {
			return null;
		} finally {
			probe.abort();
			signal.removeEventListener('abort', followAbort);
		}
	}

	/**
	 * Record the "the file is not the size the library said" observation on
	 * a transfer that DID complete: the queue row, the install card, the
	 * bar, and the log all get the true size plus a pointer at the stale
	 * entry (refresh the library, or rescan the file in RomM). Nothing
	 * happens when the sizes agree.
	 */
	#noteSizeDrift(item: DownloadItem, recordSize: number, actual: number): void {
		if (recordSize <= 0 || actual <= 0 || actual === recordSize) return;
		item.note = `library listed ${humanBytes(recordSize)}`;
		item.size = actual;
		log(
			'download',
			`${item.label}: committed ${actual} bytes while the library entry lists ${recordSize} — the entry is stale (refresh the library, or rescan the file in RomM)`,
		);
	}

	/**
	 * One transfer: space check → (resume) fetch → stream to `.part` →
	 * hash-verify → rename. Returns the final status.
	 *
	 * A stream that ends short of its declared size (a cut connection) is
	 * resumed in place, up to `MAX_RESUMES` times; a stream that errors
	 * keeps the part for the next attempt the same way. Either way the
	 * `.part` is never dropped for a transfer that merely did not finish.
	 */
	async #run(item: DownloadItem): Promise<DownloadStatus> {
		const part = item.dest + '.part';
		const controller = new AbortController();
		this.#running = { item, controller };
		let lastEmitAt = 0;

		try {
			item.phase = 'downloading';
			item.verifyProgress = 0;

			// ── space guard ───────────────────────────────────────────────
			if (item.size > 0) {
				const free = sdFreeSpace();
				if (free !== null && free < item.size) {
					throw new Error(
						`not enough SD space — need ${(item.size / 1048576).toFixed(1)} MB, ${Math.max(0, free) / 1048576} MB free`,
					);
				}
			}

			// The size the library recorded when the item was queued — the
			// thing the user was promised. Captured before anything runs,
			// because the transfer below may correct `item.size` to the size
			// the server actually vouches for.
			const recordSize = item.size;

			// ── resume point ──────────────────────────────────────────────
			let rangeStart = await fileSize(part);
			if (rangeStart < 0) rangeStart = 0;
			if (item.size > 0 && rangeStart >= item.size) {
				// The part already reached the reported size on an earlier
				// (killed-at-100%) attempt. Verify what is on disk instead of
				// re-streaming the whole file: a matching part commits in
				// place; a stale one is dropped and re-fetched from byte 0 IN
				// THIS SAME ATTEMPT. (Refetching a full-size part would append
				// onto it and double the file — the source of the hash
				// mismatches. Without the drop, one bad part failed every
				// future attempt at the verify, forever.)
				item.transferred = item.size; // the part is at 100%: the bar shows it
				this.#emit();
				if (item.hash === '') {
					// No digest to verify the part in place: the one signal
					// left is the size. The part must be exactly the server's
					// CURRENT file size — the file may have been replaced or
					// re-scanned on the server since the part was written,
					// and a part that no longer matches the server's total is
					// resume poison (committing it would install a file
					// nothing on the server describes). A failed probe keeps
					// the old behaviour — trust a part that reached the
					// recorded size — so a flaky line never regresses.
					const total = await this.#probeServerTotal(item, controller.signal);
					if (controller.signal.aborted) return 'cancelled';
					if (total !== null && total !== rangeStart) {
						await remove(part);
						rangeStart = 0;
						item.transferred = 0;
						this.#emit();
					} else {
						this.#noteSizeDrift(item, recordSize, rangeStart);
						await this.#commit(item, part);
						return 'done';
					}
				} else {
					const verdict = await this.#verifyPart(item, part);
					if (verdict === 'match') {
						this.#noteSizeDrift(item, recordSize, rangeStart);
						await this.#commit(item, part);
						return 'done';
					}
					if (verdict === 'mismatch') {
						// The part's bytes are wrong: drop it, or every future
						// attempt resumes onto (or re-verifies) the same
						// corruption.
						await remove(part);
						rangeStart = 0;
						item.transferred = 0;
						this.#emit();
					}
					// 'unreadable' keeps the part for the transfer below to
					// re-verify (a failed hash read is usually transient; the
					// alternative is burning a full re-download of resume
					// material).
				}
			}

			// ── the transfer (resumable) ─────────────────────────────────
			// One pass streams what the server sends and appends it to the
			// part. When the stream ends SHORT of its declared size the
			// connection was cut mid-flight: the part is intact up to where
			// it reached, so the next loop iteration re-fetches the tail
			// with a Range request instead of failing the item (which would
			// drop the part and start a 500 MB file over on a flaky line).
			let resumes = 0;
			let partSize = 0;
			let serverTotal = -1;
			for (;;) {
				let res = await item.fetchPart(controller.signal, rangeStart);
				if (res.status === 416) {
					// The part reached/passed the server's total (the file was
					// re-imported as a different, smaller dump): the Range can
					// never be satisfied. Drop the stale part and re-issue —
					// the retry fetches the file from byte 0.
					await remove(part);
					rangeStart = 0;
					res = await item.fetchPart(controller.signal, rangeStart);
				}
				if (res.status === 200) {
					// The server is sending the whole file from byte 0 (it
					// either ignored our Range request or we sent none):
					// clear whatever part is on disk first, or the full body
					// appends onto it and the file doubles.
					if ((await fileSize(part)) > 0) {
						await remove(part);
						rangeStart = 0;
					}
				} else if (res.status !== 206) {
					throw new Error(`server answered ${res.status} for ${item.label}`);
				}

				// The file's total size as the server declared it for this
				// response — the size it vouches for the bytes on the wire
				// (see serverTotalFrom). -1 = the server stayed silent.
				serverTotal = serverTotalFrom(res, rangeStart);

				// The body size the server declared for this attempt — the
				// one trustworthy "the stream is complete" signal. (When the
				// server stays silent on the body — a chunked answer — the
				// file total stands in for the remainder; the rom record is
				// the last resort, and the one allowed to be stale.)
				let declaredBody = -1;
				const len = res.headers.get('content-length');
				if (len !== null) {
					const n = Number(len);
					if (Number.isFinite(n) && n >= 0) declaredBody = n;
				}
				if (declaredBody < 0) {
					if (serverTotal >= 0) declaredBody = Math.max(0, serverTotal - rangeStart);
					else if (item.size > 0) declaredBody = Math.max(0, item.size - rangeStart);
				}

				let body = res.body;
				if (body === null) throw new Error('the response had no body');

				let received = 0;
				const reader = body.getReader();
				/**
				 * Batching accumulator. The stream tends to hand us many
				 * small chunks per second, and every `appendFileSync` is a
				 * synchronous system call on the main thread — one per
				 * chunk starves the frame loop even though each call is
				 * short. Coalescing into ~256 KiB writes cuts the call
				 * count roughly 10x with no effect on resume semantics (the
				 * .part grows in whole chunks either way).
				 */
				let staged: Uint8Array[] = [];
				let pending = 0;
				const FLUSH = 256 * 1024;
				const flush = async () => {
					if (staged.length === 0) return;
					const batch = staged.length === 1 ? staged[0] : concatChunks(staged);
					staged = [];
					pending = 0;
					await appendBinary(part, batch);
				};
				for (;;) {
					const { done, value } = await reader.read();
					if (done) break;
					if (value === undefined) continue;
					// Copy the chunk the moment the runtime hands it over:
					// body chunks are subarray views of the socket's scratch
					// buffer (see hash.ts), and a later read can overwrite
					// that memory before the staged batch is flushed —
					// leaving a right-sized file with duplicated bytes, which
					// is exactly the "hash mismatch" corruption. The copy is
					// a memcpy per chunk: negligible next to the MD5 pass.
					staged.push(value.slice());
					pending += value.length;
					if (pending >= FLUSH) await flush();
					received += value.length;
					item.transferred = rangeStart + received;
					// Refresh the queue views at most every EMIT_STEP_MS so
					// the bars (the Downloads screen, the install card) track
					// the transfer. Without this they freeze at the value
					// from the last status change (0%) for the whole download.
					const now = Date.now();
					if (now - lastEmitAt > EMIT_STEP_MS) {
						lastEmitAt = now;
						this.#emit();
					}
				}
				await flush();
				if (controller.signal.aborted) return 'cancelled';

				partSize = await fileSize(part);
				log(
					'download',
					`${item.label}: stream ended — received ${received} of ${declaredBody >= 0 ? declaredBody : '?'} declared bytes (part ${partSize} bytes, server file ${serverTotal >= 0 ? serverTotal : '?'} bytes, library ${recordSize > 0 ? recordSize : '?'} bytes)`,
				);

				// The part grew past the total the server declared for the
				// file: the stream delivered more bytes than the file holds —
				// a body that ignored our Range, a resume that appended the
				// whole file onto the part. No checksum needed to know the
				// bytes are wrong (with one, it would never match): drop the
				// part and fail; the next attempt re-downloads from byte 0.
				if (serverTotal >= 0 && partSize > serverTotal) {
					await remove(part);
					throw new Error(
						`the stream delivered ${partSize} bytes but the server's file is ${serverTotal} — the part was discarded, retry to start over`,
					);
				}

				// The size this attempt was supposed to reach: the body it
				// declared, and the file total at least (a content-length
				// shorter than the range it claimed would otherwise break a
				// still-incomplete part out of the loop). -1 = nothing to
				// check against.
				const expected = Math.max(
					declaredBody >= 0 ? rangeStart + declaredBody : -1,
					serverTotal,
				);
				// Complete (or no size to check against): hand off to the
				// hash verify, which is the final arbiter either way.
				if (expected < 0 || partSize >= expected) break;

				// The stream ended short: the connection was cut. The part is
				// valid up to where it reached — resume from there.
				if (resumes >= MAX_RESUMES) {
					// Keep the part: the next attempt continues from it.
					// The percentage runs against the file total the server
					// vouches for (the library record can be stale).
					const ref = serverTotal >= 0 ? serverTotal : item.size;
					const where =
						ref > 0 ? `${Math.min(100, Math.round((partSize / ref) * 100))}%` : `${partSize} bytes`;
					throw new Error(
						`connection dropped at ${where} after ${resumes} resume attempts — retry to continue (the part is kept)`,
					);
				}
				resumes += 1;
				rangeStart = partSize;
				item.transferred = partSize;
				this.#emit();
				log(
					'download',
					`${item.label}: stream ended early (part ${partSize} of ${expected} bytes) — resuming from byte ${partSize} (attempt ${resumes}/${MAX_RESUMES})`,
				);
				await new Promise<void>((r) => setTimeout(r, RESUME_DELAY_MS));
				if (controller.signal.aborted) return 'cancelled';
			}

			// ── verify ────────────────────────────────────────────────────
			// Verify the finished part BEFORE committing it: a mismatched or
			// corrupt download must never be renamed into place and made
			// available to launch. Hashing a 500 MB rom takes minutes in
			// pure JS, so the phase flips to "verifying" and progress is
			// reported while it runs.
			const verdict = await this.#verifyPart(item, part);
			if (verdict === 'mismatch') {
				throw new Error(
					recordSize > 0 && partSize > 0 && partSize !== recordSize
						? `download verification failed — hash mismatch (the library lists ${humanBytes(
								recordSize,
							)} but the server file is ${humanBytes(partSize)} — the file changed on the server since the library was built; rescan it in RomM and retry)`
						: 'download verification failed (hash mismatch)',
				);
			}
			if (verdict === 'unreadable') {
				throw new Error('could not verify the download (file unreadable)');
			}

			// The part is good, and its size differs from what the library
			// entry recorded: the entry is stale (the file was re-scanned or
			// replaced on the server since the last walk). Commit it — the
			// bytes are exactly what the server sent — but say so where the
			// user can see it, instead of a silent 525 MB file the app
			// "mentioned" as 507 MB.
			this.#noteSizeDrift(item, recordSize, partSize);

			// ── commit ────────────────────────────────────────────────────
			await this.#commit(item, part);
			return 'done';
		} catch (err) {
			const aborted = controller.signal.aborted;
			const message = aborted
				? 'cancelled'
				: err instanceof Error
				  ? err.message
				  : String(err);
			log('error', `download ${item.label}: ${message}`);
			// A failed attempt keeps its `.part` so the next attempt resumes
			// (a verification failure already dropped its part up above).
			item.error = aborted ? '' : message;
			return aborted ? 'cancelled' : 'error';
		} finally {
			if (this.#running !== null && this.#running.item === item) {
				this.#running = null;
			}
		}
	}
}

/** The process-wide queue. */
export const downloadQueue = new DownloadQueue();
