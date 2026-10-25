/**
 * Content hashes — streaming MD5 over files on the SD.
 *
 * RomM compares saves by MD5 (verified live: a downloaded save's MD5
 * equals its stored `content_hash` byte for byte), and the browser's
 * WebCrypto has no MD5. So we bundle `spark-md5` and feed it the file in
 * windows from disk: a 1 MiB window at a time keeps the (32-bit) V8 heap
 * flat no matter how big the file is.
 */
import SparkMD5 from 'spark-md5';
import { readBinary } from './fs';

/** The read window for hashing — big enough to be fast, small enough to be safe. */
const WINDOW = 1024 * 1024;

/**
 * MD5 of a file, read in windows.
 *
 * @returns the lowercase hex digest, or null when the file cannot be read.
 */
export async function md5File(path: string): Promise<string | null> {
	const spark = new SparkMD5();
	let offset = 0;
	for (;;) {
		const buf = await readBinary(path, { start: offset, end: offset + WINDOW - 1 });
		if (buf === null) return null;
		const bytes = new Uint8Array(buf);
		if (bytes.length === 0) break;
		spark.append(bytes);
		offset += bytes.length;
		if (bytes.length < WINDOW) break;
	}
	return spark.end();
}

/** MD5 of bytes already in memory (small data only — never whole files). */
export function md5Bytes(data: ArrayBuffer | Uint8Array): string {
	return SparkMD5.hash(data);
}
