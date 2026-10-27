/**
 * ROM checksum verification: streaming MD5 over a finished download.
 *
 * Reads the file in windows (never the whole ROM in the 32-bit V8 heap),
 * feeds SparkMD5's `ArrayBuffer` incrementally, and yields between windows
 * so the frame loop keeps drawing while a multi-GB rom hashes. The digest is
 * computed over the exact bytes on disk — the `.part` the download writer
 * just closed — not over anything held in memory.
 *
 * Independent of react-tela: usable by the download queue's post-download
 * check and by a manual "verify" action alike.
 */
import SparkMD5 from 'spark-md5';
import { fileSize, readBinary } from '../fs';
import { standaloneBuffer, tick, WINDOW } from '../hash';

export type ChecksumProgress = {
	bytesRead: number;
	totalBytes: number;
	percent: number;
};

export type ChecksumResult = {
	actual: string;
	expected: string;
	matches: boolean;
};

const HEX32 = /^[a-f0-9]{32}$/;

/** MD5 of `path`, read in windows, with optional progress reports. */
export async function calculateMd5(
	path: string,
	onProgress?: (progress: ChecksumProgress) => void,
): Promise<string> {
	const size = await fileSize(path);
	if (size <= 0) {
		throw new Error('ROM file is empty or unavailable');
	}

	const spark = new SparkMD5.ArrayBuffer();
	let offset = 0;
	let bytesRead = 0;

	try {
		for (;;) {
			// One window from disk, `[offset, offset+WINDOW)` (`end`
			// exclusive). The runtime clamps `end` at EOF.
			const buf = await readBinary(path, {
				start: offset,
				end: Math.min(size, offset + WINDOW),
			});
			if (buf === null) {
				throw new Error(`could not read ${path}`);
			}
			const length = buf.byteLength;
			// A window that came back empty SHORT of the end of the file
			// is a failed read, not EOF (the loop guards `offset < size`):
			// reporting it as a finished hash would "verify" a prefix.
			if (length === 0) {
				throw new Error(`could not read ${path}`);
			}

			// A standalone buffer: SparkMD5.ArrayBuffer.append mis-reads
			// views with a non-zero byteOffset (see src/hash.ts).
			spark.append(standaloneBuffer(buf));
			bytesRead += length;
			offset += length;

			onProgress?.({
				bytesRead,
				totalBytes: size,
				percent: Math.min(100, Math.floor((bytesRead / size) * 100)),
			});

			// Keep reading while the file is not fully covered. Deliberately
			// NOT `if (length < WINDOW) break`: on-device the runtime's
			// windowed read returns one byte less than requested (its docs
			// say `end` is inclusive, the binary treats it as exclusive), so
			// breaking on a short window hashed only the first ~1 MiB and
			// failed every verification in ~150 ms — a right-sized part with
			// a "hash mismatch", forever. Advancing by the length actually
			// read tiles the file exactly under either convention.
			if (offset >= size) break;
			// Let the runtime process UI and input work between windows.
			await tick();
		}

		return spark.end().toLowerCase();
	} finally {
		// reset() releases the incremental state (3.0.2 has no destroy()).
		spark.reset();
	}
}

/**
 * Compare the file's MD5 with the expected digest from library metadata.
 *
 * @throws when the expected checksum is not a 32-hex MD5, or the file
 *         cannot be read (unable to verify).
 */
export async function verifyMd5(
	path: string,
	expectedMd5: string,
	onProgress?: (progress: ChecksumProgress) => void,
): Promise<ChecksumResult> {
	const expected = expectedMd5.trim().toLowerCase();

	if (!HEX32.test(expected)) {
		throw new Error('Invalid expected MD5 checksum');
	}

	const actual = await calculateMd5(path, onProgress);

	return {
		actual,
		expected,
		matches: actual === expected,
	};
}
