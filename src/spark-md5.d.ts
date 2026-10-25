/**
 * Type declaration for `spark-md5` (a UMD/CJS module that ships no types).
 *
 * The streaming MD5 we need: RomM compares saves by MD5 (WebCrypto has no
 * MD5), and the file can be multi-MB — so we feed it in chunks from disk
 * instead of holding the whole file in the 32-bit V8 heap.
 */
declare module 'spark-md5' {
	export class SparkMD5 {
		constructor();
		/** Feed more bytes (or a UTF-8 string via `appendStr`). */
		append(bytes: ArrayBuffer | Uint8Array | string): this;
		appendStr(text: string): this;
		/** End the stream and return the hex digest. */
		end(raw?: boolean): string;
		/** True once `end()` was called. */
		reset(): this;
		/** One-shot for bytes already in memory. */
		static hash(data: ArrayBuffer | Uint8Array | string, raw?: boolean): string;
		/** The buffered state (for the incremental callers). */
		static ArrayBuffer: { hash(data: ArrayBuffer, raw?: boolean): string };
	}
	export default SparkMD5;
}
