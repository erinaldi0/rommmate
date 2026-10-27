/**
 * Type declaration for `spark-md5` (a UMD/CJS module that ships no types).
 *
 * Two traps in the 3.0.2 implementation, both of which bit the app (see
 * `hash.ts`): the string-based `SparkMD5.append` *stringifies* a typed
 * array — hashing the decimal text "0,255,254,…" instead of the bytes —
 * and `SparkMD5.ArrayBuffer.prototype.append` silently mis-reads typed
 * array *views* (a non-zero `byteOffset` loses the bytes). The declarations
 * below steer callers away from both: `append` takes a string, and the
 * `ArrayBuffer` variant takes a raw, standalone `ArrayBuffer`.
 */
declare module 'spark-md5' {
	export class SparkMD5 {
		constructor();
		/**
		 * Feed more input — a UTF-8 *string* only.
		 *
		 * ⚠️ Never pass an `ArrayBuffer`/`Uint8Array` here: 3.0.2
		 * coerces it to its decimal string representation, so the digest
		 * is of that text, not of the bytes. Use `SparkMD5.ArrayBuffer`
		 * for byte data.
		 */
		append(text: string): this;
		appendStr(text: string): this;
		/** End the stream and return the hex digest. */
		end(raw?: boolean): string;
		/** Reset the state for reuse. */
		reset(): this;
		/** One-shot for a UTF-8 string. */
		static hash(text: string, raw?: boolean): string;
		/**
		 * Incremental MD5 over raw bytes. `append` takes an `ArrayBuffer`
		 * (a standalone one — see the trap above), never a view.
		 */
		static ArrayBuffer: {
			new (): {
				append(buffer: ArrayBuffer): this;
				end(raw?: boolean): string;
				reset(): this;
			};
		};
	}
	export default SparkMD5;
}
