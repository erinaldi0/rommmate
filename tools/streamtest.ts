#!/usr/bin/env node
/**
 * Offline test for the streaming rom-list reader (`src/romm/stream.ts`)
 * against the REAL `/api/roms` payload, saved to disk.
 *
 * Feed patterns mirror exactly what the client does on-device: bytes are
 * chunked, the incomplete-UTF-8 tail is held back, the chunk is decoded,
 * and the scanner emits raw item JSON — which is JSON.parse'd here the
 * same way the client parses it.
 *
 * Run:
 *   npx esbuild tools/streamtest.ts --bundle --platform=node --format=esm --outfile=/tmp/streamtest.mjs
 *   node /tmp/streamtest.mjs [path-to-roms.json]
 *
 * The payload path defaults to /tmp/roms_all.json (saved by curl during
 * development); without it, only the synthetic cases run.
 */
import { readFileSync } from 'node:fs';
import { ItemStream, utf8IncompleteTail } from '../src/romm/stream';

let failures = 0;
function check(name: string, ok: boolean, detail = ''): void {
	if (ok) {
		console.log(`  ok    ${name}`);
	} else {
		failures += 1;
		console.log(`  FAIL  ${name}${detail !== '' ? ` — ${detail}` : ''}`);
	}
}

/** The client's exact decode loop, driven by `chunkSize`. */
function streamBytes(bytes: Uint8Array, chunkSize: number): {
	items: string[];
	total: number | null;
	limit: number | null;
	bare: boolean;
} {
	const scanner = new ItemStream();
	const decoder = new TextDecoder();
	const items: string[] = [];
	/** Bytes of an incomplete UTF-8 sequence, carried to the next chunk. */
	let pending: Uint8Array | null = null;
	const feed = (decoded: string): void => {
		items.push(...scanner.push(decoded));
	};
	for (let start = 0; start < bytes.length; start += chunkSize) {
		const value = bytes.subarray(start, Math.min(bytes.length, start + chunkSize));
		const joined = pending !== null ? concat(pending, value) : value;
		const tail = utf8IncompleteTail(joined);
		if (tail >= joined.byteLength) {
			pending = joined;
			continue;
		}
		pending = tail > 0 ? joined.slice(joined.byteLength - tail) : null;
		const usable = tail > 0 ? joined.subarray(0, joined.byteLength - tail) : joined;
		feed(decoder.decode(usable));
	}
	if (pending !== null) feed(decoder.decode(pending));
	items.push(...scanner.push(''));
	return { items, total: scanner.total, limit: scanner.limit, bare: scanner.bare };
}

function concat(a: Uint8Array, b: Uint8Array): Uint8Array {
	const out = new Uint8Array(a.length + b.length);
	out.set(a, 0);
	out.set(b, a.length);
	return out;
}

/** Multibyte + escapes torture payload: brackets and quotes inside strings. */
const SYNTHETIC = {
	items: [
		{ id: 1, name: 'Pokémon \u4e2d\u6587 "Red" [brackets] {braces}\\', nested: { a: '"items":[' } },
		{ id: 2, name: 'ACE:  エース, `\u00e9\u00ea\u00eb`', tags: ['a", b', '{c}]'] },
		{ id: 3, name: 'trailing escaped backslash \\\\' },
	],
	total: 3,
	limit: 2000,
};
const SYNTH_TEXT = JSON.stringify(SYNTHETIC);
const SYNTH_BYTES = new TextEncoder().encode(SYNTH_TEXT);

console.log('— synthetic payload —');

// Every possible chunk size, 1 byte upward, must parse identically.
const s1 = streamBytes(SYNTH_BYTES, 1);
check('1-byte chunks: item count', s1.items.length === 3, String(s1.items.length));
const s2 = streamBytes(SYNTH_BYTES, 2);
check('2-byte chunks: item count', s2.items.length === 3, String(s2.items.length));
const s7 = streamBytes(SYNTH_BYTES, 7);
check('7-byte chunks: item count', s7.items.length === 3, String(s7.items.length));
const sAll = streamBytes(SYNTH_BYTES, SYNTH_BYTES.length);
check('single chunk: item count', sAll.items.length === 3, String(sAll.items.length));

// The parsed items must round-trip exactly.
const parsed = streamBytes(SYNTH_BYTES, 3).items.map((raw) => JSON.parse(raw) as { id: number; name: string });
check('item ids in order', parsed[0]?.id === 1 && parsed[1]?.id === 2 && parsed[2]?.id === 3);
check('escapes survive (item 1 name)', parsed[0]?.name === SYNTHETIC.items[0].name, parsed[0]?.name);
check('escapes survive (item 3 name)', parsed[2]?.name === SYNTHETIC.items[2].name, parsed[2]?.name);
check('total/limit reported', sAll.total === 3 && sAll.limit === 2000, `total=${sAll.total} limit=${sAll.limit}`);
check('wrapper shape not bare', sAll.bare === false);

// Wrapper with `total` BEFORE `items` (different key order).
const reordered = new TextEncoder().encode(
	JSON.stringify({ total: 3, limit: 50, offset: 0, items: SYNTHETIC.items, char_index: { a: [1] } }),
);
const r1 = streamBytes(reordered, 5);
check('reordered wrapper: items', r1.items.length === 3, String(r1.items.length));
check('reordered wrapper: total/limit', r1.total === 3 && r1.limit === 50, `total=${r1.total} limit=${r1.limit}`);

// Bare top-level array (the ≤4.x shape).
const bare = new TextEncoder().encode(JSON.stringify(SYNTHETIC.items));
const b1 = streamBytes(bare, 9);
check('bare array: items', b1.items.length === 3, String(b1.items.length));
check('bare array: flagged', b1.bare === true);

// Incomplete tail (truncated response): the partial item is dropped,
// the complete ones survive.
const cut = new TextEncoder().encode(
	'[' + JSON.stringify(SYNTHETIC.items[0]) + ',' + JSON.stringify(SYNTHETIC.items[1]).slice(0, 40),
);
const c1 = streamBytes(cut, 13);
check('truncated stream: complete items only', c1.items.length === 1, String(c1.items.length));

// `items` present but not an array: zero items, no crash (the wrapper's
// scalars are still read — `total: 0` is genuinely in the payload).
const wrong = new TextEncoder().encode('{"items":null,"total":0}');
const w1 = streamBytes(wrong, 4);
check('items not an array: zero items, total read', w1.items.length === 0 && w1.total === 0, `total=${w1.total}`);

// Garbage top level: zero items, no crash.
const g1 = streamBytes(new TextEncoder().encode('"just a string"'), 3);
check('garbage top level: zero items', g1.items.length === 0);

// utf8IncompleteTail directly — raw bytes, since string escapes through
// TextEncoder would arrive already complete.
check('tail: ascii', utf8IncompleteTail(new Uint8Array([0x61, 0x62, 0x63])) === 0);
check('tail: complete 2-byte', utf8IncompleteTail(new Uint8Array([0x61, 0xc3, 0xa9])) === 0);
check('tail: split 2-byte', utf8IncompleteTail(new Uint8Array([0x61, 0x62, 0xc3])) === 1);
check('tail: split 3-byte', utf8IncompleteTail(new Uint8Array([0x61, 0xe4, 0xb8])) === 2);
check('tail: split 4-byte', utf8IncompleteTail(new Uint8Array([0x61, 0xf0, 0x9f, 0x92])) === 3);
check('tail: emoji whole', utf8IncompleteTail(new Uint8Array([0x61, 0xf0, 0x9f, 0x92, 0xa9])) === 0);
check('tail: continuation run then lead', utf8IncompleteTail(new Uint8Array([0x61, 0x80, 0x80, 0xc3])) === 1);

// ── the real payload ──────────────────────────────────────────────────────
const path = process.argv[2] ?? '/tmp/roms_all.json';
let real: Uint8Array;
try {
	real = new Uint8Array(readFileSync(path));
} catch {
	console.log(`\n(real payload ${path} not present — synthetic cases only)`);
	if (failures > 0) process.exit(1);
	process.exit(0);
}

console.log(`\n— real payload (${(real.length / 1024 / 1024).toFixed(1)} MB) —`);
const t0 = Date.now();
const real1 = streamBytes(real, 65536); // a typical network chunk
const ms = Date.now() - t0;
check('64 KB chunks: 1266 items', real1.items.length === 1266, String(real1.items.length));
console.log(`        (parsed in ${ms} ms, total=${real1.total}, limit=${real1.limit})`);

const real2 = streamBytes(real, 7919); // an awkward prime
check('7919-byte chunks: 1266 items', real2.items.length === 1266, String(real2.items.length));

// Pathological chunk sizes on a head slice (the scanner is a pure
// left-to-right machine, so a chunk size that survives the wrapper's
// opening survives everywhere; the full 26 MB at 1 byte/chunk would be
// quadratic in the test harness alone).
const HEAD = 512 * 1024;
const head = real.subarray(0, HEAD);
for (const size of [1, 2, 3, 7, 13, 4096]) {
	const r = streamBytes(head, size);
	// ~21 KB per rom → the head holds ~24; the last one may straddle the
	// cut (dropped), so anything in the low twenties is a clean parse.
	check(`${size}-byte chunks (head): parse`, r.items.length >= 20, String(r.items.length));
}

// Spot-check the first and last roms.
const first = JSON.parse(real1.items[0]!) as { id: number; name: string };
const last = JSON.parse(real1.items[real1.items.length - 1]!) as { id: number; name: string };
console.log(`        first: #${first.id} ${first.name}`);
console.log(`        last:  #${last.id} ${last.name}`);
check('first item id is a number', typeof first.id === 'number');
check('last item id is a number', typeof last.id === 'number');
check('reported total matches count', real1.total === 1266, String(real1.total));

if (failures > 0) {
	console.log(`\n${failures} FAILURE(S)`);
	process.exit(1);
}
console.log('\nall stream tests passed');
