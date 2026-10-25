#!/usr/bin/env node
/**
 * Live E2E for the streaming library walk + the NDJSON cache, against a
 * real RomM (the .env token, hit directly — no CORS proxy needed in
 * node):
 *
 *   1. `getGamesStream` walks the whole library in one streamed request;
 *      verify the count against the paged walk's total and time it.
 *   2. `writeLibraryCache` + `readLibraryCache` round-trip the result
 *      through the in-memory filesystem (this is the preview's fs; on the
 *      Switch it would be the SD card).
 *   3. The cache rejects a different instance base.
 *
 * Run:
 *   npx esbuild tools/libtest.ts --bundle --platform=node --format=esm --outfile=/tmp/libtest.mjs
 *   node /tmp/libtest.mjs
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { RommClient } from '../src/romm/client';
import type { RommGame } from '../src/romm/types';
import { readLibraryCache, writeLibraryCache } from '../src/library-cache';

const env = readFileSync(path.resolve(process.cwd(), '.env'), 'utf8');
const url = /^url\s*=\s*(\S+)/m.exec(env)?.[1] ?? '';
const token = /^token\s*=\s*(\S+)/m.exec(env)?.[1] ?? '';
if (url === '' || token === '') {
	console.error('need url + token in .env');
	process.exit(1);
}

let failures = 0;
function check(name: string, ok: boolean, detail = ''): void {
	if (ok) console.log(`  ok    ${name}`);
	else {
		failures += 1;
		console.log(`  FAIL  ${name}${detail !== '' ? ` — ${detail}` : ''}`);
	}
}

const client = new RommClient(url, token);

// ── 1. the streamed walk ───────────────────────────────────────────────────
console.log('— streamed walk —');
const games: RommGame[] = [];
let batches = 0;
let firstBatchAt = -1;
const t0 = Date.now();
const streamed = await client.getGamesStream(
	(batch) => {
		batches += 1;
		if (firstBatchAt < 0) firstBatchAt = Date.now() - t0;
		games.push(...batch);
	},
	(loaded, total) => {
		if (loaded % 500 === 0 || loaded === total) console.log(`        ${loaded}/${total}`);
	},
);
const streamMs = Date.now() - t0;
check('no error', streamed.error === null, streamed.error ?? '');
console.log(`        ${games.length} games in ${streamMs} ms (first batch at +${firstBatchAt} ms, ${batches} batches)`);
check('games parsed', games.length > 1000, String(games.length));
check('not truncated', streamed.truncated === false);
check('no duplicate ids', new Set(games.map((g) => g.id)).size === games.length);

// The paged walk agrees on the count.
const paged = await client.getGames(() => {});
check('paged walk agrees', paged.games.length === games.length, `paged=${paged.games.length} streamed=${games.length}`);

// ── 2. the cache round-trip ───────────────────────────────────────────────
console.log('— cache round-trip —');
await writeLibraryCache(client.base, streamed.error === null ? games : []);
const readBack = await readLibraryCache(client.base);
check('cache read back', readBack !== null && readBack.length === games.length, String(readBack?.length));
if (readBack !== null && games.length > 0) {
	check('first game survives verbatim', JSON.stringify(readBack[0]) === JSON.stringify(games[0]));
	check('last game survives verbatim', JSON.stringify(readBack[readBack.length - 1]) === JSON.stringify(games[games.length - 1]));
	check('cover urls absolute', readBack.every((g) => !g.coverUrl.startsWith('/')));
}

// A different instance base must be rejected.
const other = await readLibraryCache('http://some-other-server:8200');
check('foreign base rejected', other === null);

// ── 3. a fresh client sees the same (server-side sanity) ──────────────────
const probe = await client.authenticate();
check('auth probe ok', probe === null, probe ?? '');

if (failures > 0) {
	console.log(`\n${failures} FAILURE(S)`);
	process.exit(1);
}
console.log('\nall live tests passed');
