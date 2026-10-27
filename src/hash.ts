/**
 * Content hashes — streaming MD5 over files on the SD.
 *
 * RomM records a real byte MD5 for its files, and the browser's WebCrypto
 * has no MD5. So we bundle `spark-md5` and feed it the file in windows
 * from disk: a 1 MiB window at a time keeps the (32-bit) V8 heap flat no
 * matter how big the file is.
 *
 * The byte windows go through `SparkMD5.ArrayBuffer` — the string-based
 * `SparkMD5.append` would stringify a typed array (hashing the decimal
 * text "0,255,254,…" instead of the bytes, which is how the app ended up
 * comparing a garbage digest against RomM's real one and failing every
 * hashed download as a "hash mismatch"). See `standaloneBuffer`.
 *
 * The window loop must cover the WHOLE file: the runtime's windowed read
 * returns one byte less than requested on-device (`end` exclusive, its
 * docs say inclusive — the "hash mismatch on every download" bug was the
 * old `length < WINDOW` break stopping after the first window), so the
 * windows tile the file by the length actually returned, not the size
 * requested.
 */
import SparkMD5 from 'spark-md5';
import { fileSize, readBinary, standaloneBuffer } from './fs';

// Re-exported for callers that still reach it through the hash module
// (the checksum service imports the shared helpers from here).
export { standaloneBuffer };

/** The read window for hashing — big enough to be fast, small enough to be safe. */
export const WINDOW = 1024 * 1024;

/**
 * One macrotask tick. SparkMD5 is pure JS running on the main thread, so
 * without this a large hash monopolizes the loop for tens of seconds and
 * the UI freezes until the verification finishes. Yielding after every
 * window costs almost nothing but keeps frames drawing throughout.
 */
export const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

/**
 * MD5 of a file, read in windows.
 *
 * @returns the lowercase hex digest, or null when the file cannot be read.
 */
export async function md5File(path: string): Promise<string | null> {
	const size = await fileSize(path);
	if (size <= 0) return null;

	const spark = new SparkMD5.ArrayBuffer();
	let offset = 0;
	try {
		for (;;) {
			if (offset >= size) break;
			// One window, `[offset, offset+WINDOW)` (`end` exclusive).
			const buf = await readBinary(path, {
				start: offset,
				end: Math.min(size, offset + WINDOW),
			});
			if (buf === null) return null;
			const length = buf.byteLength;
			if (length === 0) return null; // a failed read short of EOF
			spark.append(standaloneBuffer(buf));
			// Advance by the bytes actually read: on-device the runtime's
			// windowed read returns one byte less than requested (its docs
			// say `end` is inclusive, the binary treats it as exclusive), so
			// breaking on a short window would hash only the first ~1 MiB —
			// a "hash mismatch" on every hashed file, forever.
			offset += length;
			await tick();
		}
		return spark.end();
	} finally {
		// reset() releases the incremental state (3.0.2 has no destroy()).
		spark.reset();
	}
}

/** MD5 of bytes already in memory (small data only — never whole files). */
export function md5Bytes(data: ArrayBuffer | Uint8Array): string {
	const spark = new SparkMD5.ArrayBuffer();
	spark.append(standaloneBuffer(data));
	return spark.end();
}
