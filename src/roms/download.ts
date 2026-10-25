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
 * roms on a flaky home Wi-Fi.
 *
 * The queue is a process-wide singleton reporting into the activity store
 * (the top-right badge), so downloads stay visible from any screen.
 */
import { setActivity } from '../activity';
import { appendBinary, exists, fileSize, move, remove, sdFreeSpace } from '../fs';
import { md5File } from '../hash';
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
	/** Called with the final status once the item is done (bookkeeping). */
	onDone?: (status: DownloadStatus) => void;
	/**
	 * The promise `add()` returned for this item (queue-internal: lets a
	 * second `add()` of the same path join the in-flight transfer).
	 */
	promise?: Promise<DownloadStatus>;
}

/** How often the badge label is allowed to change (a % step). */
const PROGRESS_STEP_MS = 250;

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
	/** 0..1 while running, 1 when done, 0 otherwise. */
	progress: number;
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
			progress:
				item.status === 'done'
					? 1
					: item.status === 'running' && item.size > 0
					  ? Math.min(1, item.transferred / item.size)
					  : 0,
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
		item: Omit<DownloadItem, 'status' | 'transferred' | 'error'>,
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

	/**
	 * One transfer: space check → (resume) fetch → stream to `.part` →
	 * hash-verify → rename. Returns the final status.
	 */
	async #run(item: DownloadItem): Promise<DownloadStatus> {
		const part = item.dest + '.part';
		const controller = new AbortController();
		this.#running = { item, controller };
		let lastLabelAt = 0;

		try {
			// ── space guard ───────────────────────────────────────────────
			if (item.size > 0) {
				const free = sdFreeSpace();
				if (free !== null && free < item.size) {
					throw new Error(
						`not enough SD space — need ${(item.size / 1048576).toFixed(1)} MB, ${Math.max(0, free) / 1048576} MB free`,
					);
				}
			}

			// ── resume point ──────────────────────────────────────────────
			let rangeStart = await fileSize(part);
			if (rangeStart < 0) rangeStart = 0;
			if (item.size > 0 && rangeStart >= item.size) {
				// The part is already the full size (a killed-at-100%
				// attempt): verify what is there instead of refetching.
				rangeStart = 0;
			}

			// ── the transfer ──────────────────────────────────────────────
			const res = await item.fetchPart(controller.signal, rangeStart);
			if (res.status === 200) {
				// The server ignored the Range request: start over.
				if (rangeStart > 0) {
					await remove(part);
					rangeStart = 0;
				}
			} else if (res.status === 206) {
				// A proper resume: keep appending to the part.
			} else {
				throw new Error(`server answered ${res.status} for ${item.label}`);
			}

			let body = res.body;
			if (body === null) throw new Error('the response had no body');

			let received = 0;
			const reader = body.getReader();
			/**
			 * Batching accumulator. The stream tends to hand us many small
			 * chunks per second, and every `appendFileSync` is a synchronous
			 * system call on the main thread — one per chunk starves the
			 * frame loop even though each call is short. Coalescing into
			 * ~256 KiB writes cuts the call count roughly 10x with no effect
			 * on resume semantics (the .part grows in whole chunks either way).
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
				staged.push(value);
				pending += value.length;
				if (pending >= FLUSH) await flush();
				received += value.length;
				item.transferred = rangeStart + received;
				// Throttled: the badge repaints at most every 250 ms.
				const now = Date.now();
				if (now - lastLabelAt > PROGRESS_STEP_MS) {
					lastLabelAt = now;
					setActivity(
						'download',
						item.size > 0
							? `↓ ${item.label} ${Math.floor((item.transferred / item.size) * 100)}%`
							: `↓ ${item.label} ${(item.transferred / 1024 / 1024).toFixed(1)} MB`,
					);
				}
			}
			await flush();
			if (controller.signal.aborted) return 'cancelled';

			// ── verify ────────────────────────────────────────────────────
			if (item.hash !== '') {
				const actual = await md5File(part);
				if (actual === null) {
					throw new Error('could not verify the download (file unreadable)');
				}
				if (actual.toLowerCase() !== item.hash.toLowerCase()) {
					await remove(part);
					throw new Error('download verification failed (hash mismatch)');
				}
			}

			// ── commit ────────────────────────────────────────────────────
			if (await exists(item.dest)) await remove(item.dest);
			await move(part, item.dest);
			log('download', `ok ${item.label} → ${item.dest}`);
			return 'done';
		} catch (err) {
			const aborted = controller.signal.aborted;
			const message = aborted
				? 'cancelled'
				: err instanceof Error
				  ? err.message
				  : String(err);
			log('error', `download ${item.label}: ${message}`);
			// A failed attempt keeps its `.part`: the next attempt resumes.
			item.error = aborted ? '' : message;
			return aborted ? 'cancelled' : 'error';
		} finally {
			if (this.#running !== null && this.#running.item === item) {
				this.#running = null;
			}
			setActivity('download', null);
		}
	}
}

/** The process-wide queue. */
export const downloadQueue = new DownloadQueue();
