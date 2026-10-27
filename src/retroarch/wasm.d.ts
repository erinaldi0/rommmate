/**
 * The 7z-wasm package is consumed raw (the ES-module glue + the bare
 * binary), which its own typings don't cover — declare what we use.
 */

declare module '7z-wasm/7zz.es6.js' {
	/** The Emscripten factory: initializes once, drives via `callMain`. */
	const init7z: (opts?: Record<string, unknown>) => Promise<unknown>;
	export default init7z;
}

declare module '7z-wasm/7zz.wasm' {
	// esbuild's `binary` loader default-exports a Uint8Array of the file.
	const wasmBinary: Uint8Array;
	export default wasmBinary;
}
