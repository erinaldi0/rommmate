/**
 * Streaming extraction of the rom list.
 *
 * A full library as one `/api/roms` answer is tens of megabytes — far
 * beyond what the Switch's heap may `res.json()` at once. But the UI only
 * needs one rom at a time, so the response body is read as a stream and
 * this scanner walks the JSON incrementally, handing back each top-level
 * array entry as soon as it is complete: the heap never holds more than
 * one raw rom object, and the SD cache is written while the walk runs.
 *
 * It understands the two shapes `/api/roms` answers with:
 *   - the 5.x wrapper `{ "items": [ {...}, ... ], "total": n, ... }`
 *     (whose `total` / `limit` scalars it also reports — they sit *after*
 *     the items in key order, so they only become known at the end);
 *   - a bare top-level array (the ≤4.x shape) — though the client only
 *     streams the modern dialect, the scanner keeps the case so the
 *     legacy fallback needs no second code path.
 *
 * Deliberately not a general JSON parser: it only skips values it does
 * not care about, and every scan is string-aware (a rom name may contain
 * brackets, quotes and escapes — a naive depth counter would desync).
 */

/**
 * How many trailing bytes of `u8` may belong to a UTF-8 sequence that
 * continues in the next chunk.
 *
 * The stream is decoded chunk-by-chunk; a multi-byte character (é, 中, …)
 * split across a chunk boundary would otherwise decode to U+FFFD. The
 * scanner's callers trim these bytes and carry them over. Splitting at
 * any non-continuation boundary is always safe: a UTF-8 continuation
 * byte (0b10xxxxxx) never collides with ASCII, so structure characters
 * (`{`, `["`, `]`) are never misdetected.
 */
export function utf8IncompleteTail(u8: Uint8Array): number {
	// Walk back over continuation bytes.
	let i = u8.length - 1;
	let cont = 0;
	while (i >= 0 && cont < 4 && (u8[i]! & 0xc0) === 0x80) {
		i -= 1;
		cont += 1;
	}
	if (i < 0) return cont; // four continuation bytes — malformed; decode as-is
	const lead = u8[i]!;
	let need: number;
	if ((lead & 0x80) === 0) need = 1; // ASCII
	else if ((lead & 0xe0) === 0xc0) need = 2;
	else if ((lead & 0xf0) === 0xe0) need = 3;
	else if ((lead & 0xf8) === 0xf0) need = 4;
	else return 0; // stray byte — decode as-is
	return u8.length - i < need ? u8.length - i : 0;
}

/** Scan a JSON string starting at `i` (the opening quote). -1 when incomplete. */
function scanString(buf: string, i: number): number {
	let j = i + 1;
	while (j < buf.length) {
		const c = buf[j];
		if (c === '\\') {
			j += 2; // the escaped character rides along, even `\"`
			continue;
		}
		if (c === '"') return j + 1;
		j += 1;
	}
	return -1;
}

/**
 * Scan a balanced `{…}` / `[…]` starting at `i`. -1 when incomplete.
 * String-aware: brackets inside string values do not count.
 */
function scanBalanced(buf: string, i: number): number {
	let depth = 0;
	let j = i;
	while (j < buf.length) {
		const c = buf[j];
		if (c === '"') {
			j = scanString(buf, j);
			if (j === -1) return -1;
			continue;
		}
		if (c === '{' || c === '[') {
			depth += 1;
			j += 1;
			continue;
		}
		if (c === '}' || c === ']') {
			depth -= 1;
			j += 1;
			if (depth === 0) return j;
			continue;
		}
		j += 1;
	}
	return -1;
}

/**
 * Skip one JSON value of any shape starting at `i`. -1 when incomplete
 * (a number or literal may continue in the next chunk — it is only
 * "done" once a structural character terminates it).
 */
function scanValue(buf: string, i: number): number {
	const c = buf[i];
	if (c === '"') return scanString(buf, i);
	if (c === '{' || c === '[') return scanBalanced(buf, i);
	let j = i;
	while (j < buf.length) {
		const ch = buf[j];
		if (ch === ',' || ch === '}' || ch === ']' || ch === ' ' || ch === '\n' || ch === '\r' || ch === '\t') {
			return j;
		}
		j += 1;
	}
	return -1;
}

/**
 * The incremental scanner: `push` decoded text, collect complete raw
 * item JSON strings. Between pushes it holds only the unprocessed
 * remainder (at most one rom object plus the wrapper tail).
 */
export class ItemStream {
	#buf = '';
	/** Scan cursor into `#buf` (compacted away after each push). */
	#pos = 0;
	/** 'seek': looking for the items array; 'items': inside it; 'done'. */
	#phase: 'seek' | 'items' | 'done' = 'seek';
	/**
	 * The seek's own resume point, because a chunk may land anywhere —
	 * between a wrapper's key and its colon, say. 'start' wants the top
	 * level's `{` / `[`; 'key' a key string (or the object's `}`); 'colon'
	 * its `:`; 'open' the value's first byte (`[` for items); 'value' the
	 * skipping of a non-items value; 'afterValue' the `,` / `}` that ends it.
	 */
	#seekStage: 'start' | 'key' | 'colon' | 'open' | 'value' | 'afterValue' = 'start';
	/** The wrapper key whose value is being skipped (`seekStage` value). */
	#pendingKey: string | null = null;
	/** The payload was a bare top-level array (no wrapper scalars follow). */
	#bare = false;
	/** True once the wrapper's scalars have been read (buffering stops). */
	#closed = false;
	#total: number | null = null;
	#limit: number | null = null;

	/** The wrapper's `total` (null until the tail has streamed past). */
	get total(): number | null {
		return this.#total;
	}

	/** The wrapper's echoed `limit` — the page size the server used. */
	get limit(): number | null {
		return this.#limit;
	}

	/** True when the payload was a bare array (≤4.x shape). */
	get bare(): boolean {
		return this.#bare;
	}

	/**
	 * Feed one decoded text chunk; returns every item that completed.
	 * An empty push flushes what can still be scanned (never a partial
	 * item — an incomplete tail is dropped, which only happens on a
	 * truncated response).
	 */
	push(text: string): string[] {
		if (this.#closed) return [];
		if (text !== '') this.#buf += text;
		const out: string[] = [];
		for (;;) {
			let progressed = false;
			if (this.#phase === 'seek') {
				progressed = this.#seekStep();
			} else if (this.#phase === 'items') {
				progressed = this.#itemsStep(out);
			}
			if (!progressed) break;
		}
		if (this.#phase === 'done') this.#readTail();
		// Drop everything scanned; keep only the unprocessed remainder.
		if (this.#pos > 0) {
			this.#buf = this.#buf.slice(this.#pos);
			this.#pos = 0;
		}
		return out;
	}

	/**
	 * One step of the seek: skip the wrapper's other keys (or accept a
	 * bare top-level array) until the items array opens. True when the
	 * state advanced enough to justify another step.
	 *
	 * Fully resumable: a push may end between any two tokens — between a
	 * key and its colon, between the colon and the value's `[`, mid-key,
	 * mid-value — and the stage machine picks up exactly there on the
	 * next push.
	 */
	#seekStep(): boolean {
		const buf = this.#buf;
		let j = this.#pos;
		for (;;) {
			j = this.#skipWs(j);
			if (j >= buf.length) {
				this.#pos = j;
				return false;
			}
			switch (this.#seekStage) {
				case 'start': {
					if (buf[j] === '[') {
						// Bare array: the items are the top level.
						this.#bare = true;
						this.#pos = j + 1;
						this.#phase = 'items';
						return true;
					}
					if (buf[j] !== '{') {
						// Neither shape this scanner understands — give up
						// quietly; the caller sees zero items and falls back.
						this.#phase = 'done';
						return true;
					}
					j += 1;
					this.#seekStage = 'key';
					continue;
				}
				case 'key': {
					if (buf[j] === '}') {
						this.#pos = j + 1;
						this.#phase = 'done';
						return true;
					}
					if (buf[j] !== '"') {
						this.#phase = 'done';
						return true;
					}
					const keyEnd = scanString(buf, j);
					if (keyEnd === -1) {
						this.#pos = j;
						return false;
					}
					this.#pendingKey = buf.slice(j + 1, keyEnd - 1);
					j = keyEnd;
					this.#seekStage = 'colon';
					continue;
				}
				case 'colon': {
					if (buf[j] !== ':') {
						this.#phase = 'done';
						return true;
					}
					j += 1; // consumed — the next push must not re-read it
					this.#seekStage = 'open';
					continue;
				}
				case 'open': {
					if (this.#pendingKey === 'items') {
						if (buf[j] !== '[') {
							// `items` is not an array (an error payload?) —
							// nothing to stream.
							this.#pos = j;
							this.#phase = 'done';
							return true;
						}
						this.#pos = j + 1;
						this.#phase = 'items';
						return true;
					}
					this.#seekStage = 'value';
					continue;
				}
				case 'value': {
					// Skip a non-items value. The wrapper's own scalars are
					// captured as they are skipped — they may sit *before*
					// the items array (key order is the server's choice).
					if (
						(this.#pendingKey === 'total' || this.#pendingKey === 'limit') &&
						buf[j] >= '0' && buf[j] <= '9'
					) {
						const numEnd = scanValue(buf, j);
						if (numEnd === -1) {
							this.#pos = j;
							return false;
						}
						const n = Number(buf.slice(j, numEnd));
						if (this.#pendingKey === 'total') this.#total = n;
						else this.#limit = n;
						j = numEnd;
						this.#seekStage = 'afterValue';
						continue;
					}
					const vEnd = scanValue(buf, j);
					if (vEnd === -1) {
						this.#pos = j;
						return false;
					}
					j = vEnd;
					this.#seekStage = 'afterValue';
					continue;
				}
				case 'afterValue': {
					if (buf[j] === ',') {
						j += 1;
						this.#seekStage = 'key';
						continue;
					}
					if (buf[j] === '}') {
						this.#pos = j + 1;
						this.#phase = 'done';
						return true;
					}
					this.#phase = 'done';
					return true;
				}
			}
		}
	}

	/**
	 * One step inside the items array: emit the next complete object,
	 * skip separators. True when the scan moved.
	 */
	#itemsStep(out: string[]): boolean {
		const buf = this.#buf;
		let j = this.#skipWs(this.#pos);
		if (j >= buf.length) {
			this.#pos = j;
			return false;
		}
		const c = buf[j];
		if (c === ']') {
			this.#pos = j + 1;
			this.#phase = 'done';
			return true;
		}
		if (c === ',') {
			this.#pos = j + 1;
			return true;
		}
		if (c !== '{') {
			// Not an object (a stray primitive?) — skip it whole.
			const vEnd = scanValue(buf, j);
			if (vEnd === -1) {
				this.#pos = j;
				return false;
			}
			this.#pos = vEnd;
			return true;
		}
		const end = scanBalanced(buf, j);
		if (end === -1) {
			// The object continues in the next chunk; resume at its `{`.
			this.#pos = j;
			return false;
		}
		out.push(buf.slice(j, end));
		this.#pos = end;
		return true;
	}

	/**
	 * After the items array: pull the wrapper's `total` / `limit` scalars
	 * out of whatever followed. They are re-read on every push until both
	 * are found (they stream in with their own chunks).
	 */
	#readTail(): void {
		if (this.#closed) return;
		if (this.#bare || (this.#total !== null && this.#limit !== null)) {
			// Everything that matters has been read (a bare array has no
			// wrapper scalars at all); stop buffering.
			this.#closed = true;
			this.#buf = '';
			this.#pos = 0;
			return;
		}
		const tail = this.#buf.slice(this.#pos);
		const t = /"total"\s*:\s*(\d+)/.exec(tail);
		if (t !== null && this.#total === null) this.#total = Number(t[1]);
		const l = /"limit"\s*:\s*(\d+)/.exec(tail);
		if (l !== null && this.#limit === null) this.#limit = Number(l[1]);
		// The scalars may never come (a malformed tail): stop buffering
		// once the tail is clearly beyond their rightful place.
		if (tail.length > 65536) {
			this.#closed = true;
			this.#buf = '';
			this.#pos = 0;
		}
	}

	#skipWs(i: number): number {
		const buf = this.#buf;
		while (i < buf.length) {
			const c = buf[i];
			if (c !== ' ' && c !== '\n' && c !== '\r' && c !== '\t') break;
			i += 1;
		}
		return i;
	}
}
