/**
 * Dev-only: end-to-end test of the save-sync loop against the live server,
 * through the preview's CORS proxy.
 *
 * In Node the fs layer is the in-memory tree (no `Switch` global), so the
 * "SD card" is a plain JS object — which makes the whole loop runnable off
 * device: negotiate, upload, download, snapshot, manifest persistence.
 *
 * The test creates its own throwaway saves (a probe save plus one upload)
 * on two roms that hold no real user data, verifies the round trip, then
 * deletes everything it created. It must never touch a real save.
 *
 * Run:  node tools/preview/proxy.mjs          (first)
 *       node tools/synctest.mjs TOKEN         (bundled with esbuild)
 */
import { RommClient } from '../src/romm';
import { runSaveSync } from '../src/saves/sync';
import { freshManifest, type Manifest } from '../src/manifest';
import { readBinary, writeBinary } from '../src/fs';
import { baseName, PATHS } from '../src/retroarch/layout';
import { getSaves, uploadSave } from '../src/romm/play';

const BASE = 'http://127.0.0.1:8732';
const TOKEN = process.argv[2] ?? process.env.ROMMATE_TOKEN ?? '';
if (TOKEN === '') {
	console.error('usage: node synctest.mjs <token>');
	process.exit(2);
}

let failures = 0;
function check(label: string, ok: boolean, detail = ''): void {
	console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? ` — ${detail}` : ''}`);
	if (!ok) failures += 1;
}

const client = new RommClient(BASE, TOKEN);

// Two roms that hold no real user saves on this instance.
const ROM_A = 4; // local autosave file, server has none  → expect an upload
const ROM_B = 3; // probe save on the server, no local   → expect a download

const { game: romA, error: errA } = await client.getRom(ROM_A);
const { game: romB, error: errB } = await client.getRom(ROM_B);
if (errA !== null || errB !== null) {
	console.error(`getRom failed: ${errA ?? ''} ${errB ?? ''}`.trim());
	process.exit(2);
}
if (romA === null || romB === null) {
	console.error('the probe roms must exist on the server');
	process.exit(2);
}
const fileA = romA.files[0]?.fileName ?? '';
const fileB = romB.files[0]?.fileName ?? '';
const baseA = baseName(fileA);
const baseB = baseName(fileB);

// Guard: refuse to run against a rom that already holds saves.
for (const id of [ROM_A, ROM_B]) {
	const existing = await getSaves(client, [id]);
	if (existing !== null && existing.length > 0) {
		console.error(`rom ${id} already has ${existing.length} save(s) — refusing, pick other roms`);
		process.exit(2);
	}
}

console.log(`rom A: ${romA.name} (${fileA})`);
console.log(`rom B: ${romB.name} (${fileB})`);

// ── set up the throwaway state ─────────────────────────────────────────────
const A = new TextEncoder().encode('rommmate-probe-A\n');
const B = new TextEncoder().encode('rommmate-probe-B\n');

// The probe save on the server. Slot `autosave` mirrors the real scenario
// (a save another client wrote for a rom this console has installed): the
// local `.srm` file derives the same slot, so the pair converges to a
// no-op on the second sync.
const probe = await uploadSave(client, {
	romId: ROM_B,
	fileName: `${baseB}.srm`,
	bytes: B,
	slot: 'autosave',
	emulator: 'rommmate-test',
	contentHash: null,
});
console.log(`probe save on server: ${probe ? `id ${probe.id}` : 'upload failed'}`);
check('probe save uploaded', probe !== null);

// The local "SD" file for rom A.
await writeBinary(`${PATHS.savesDir}/${baseA}.srm`, A);

// A manifest with both roms installed (the sync's scope).
const manifest: Manifest = freshManifest();
manifest.roms[String(ROM_A)] = {
	romId: ROM_A,
	name: romA.name,
	platform: romA.platform,
	platformId: romA.platformId,
	files: [],
	extractDirs: [],
	playPath: `sdmc:/switch/rommmate/roms/test/${fileA}`,
	outdated: false,
};
manifest.roms[String(ROM_B)] = {
	romId: ROM_B,
	name: romB.name,
	platform: romB.platform,
	platformId: romB.platformId,
	files: [],
	extractDirs: [],
	playPath: `sdmc:/switch/rommmate/roms/test/${fileB}`,
	outdated: false,
};

// ── the sync ───────────────────────────────────────────────────────────────
console.log('\nsyncing…');
const report = await runSaveSync(client, manifest);
console.log(`report: ↑${report.uploaded} ↓${report.downloaded} ✕${report.deleted} !${report.conflicts} =${report.noOps} states:${report.states}${report.error ? ` error:"${report.error}"` : ''}`);
check('upload happened', report.uploaded === 1, `uploaded=${report.uploaded}`);
check('download happened', report.downloaded === 1, `downloaded=${report.downloaded}`);
check('no error', report.error === '', report.error);
check('no conflicts', report.conflicts === 0);

// ── verify the effects ─────────────────────────────────────────────────────
// The download landed at the rom-derived name (joins back to rom B).
const restored = await readBinary(`${PATHS.savesDir}/${baseB}.srm`);
check(
	'downloaded save on "sd" at rom-derived path',
	restored !== null && new TextDecoder().decode(restored) === 'rommmate-probe-B\n',
	restored === null ? 'missing' : `${restored.byteLength} bytes`,
);
// The upload did not clobber the local file.
const localA = await readBinary(`${PATHS.savesDir}/${baseA}.srm`);
check(
	'local file untouched by the upload',
	localA !== null && new TextDecoder().decode(localA) === 'rommmate-probe-A\n',
);
// The upload reached the server under the paired slot + the real hash.
const serverA = await getSaves(client, [ROM_A]);
const aEntry = serverA?.find((s) => s.slot === 'autosave') ?? null;
check('server has the uploaded autosave', aEntry !== null, aEntry?.fileName ?? '');
check(
	'server stored the content hash',
	aEntry !== null && aEntry.contentHash !== null && aEntry.contentHash !== '',
	aEntry?.contentHash ?? 'none',
);
// The manifest was persisted (in the in-memory tree).
const saved = await import('../src/manifest');
const manifestBack = await saved.loadManifest();
check('manifest persisted + reloaded', manifestBack.roms[String(ROM_A)] !== undefined);
check('device registered', manifest.deviceId !== null, manifest.deviceId ?? 'none');

// ── stability: a second sync must be a no-op on the paired save ────────────
console.log('\nsecond sync (stability)…');
const report2 = await runSaveSync(client, manifest);
console.log(`report: ↑${report2.uploaded} ↓${report2.downloaded} =${report2.noOps}${report2.error ? ` error:"${report2.error}"` : ''}`);
check('second sync is quiet', report2.uploaded + report2.downloaded + report2.deleted === 0, `↑${report2.uploaded} ↓${report2.downloaded} ✕${report2.deleted}`);

// ── clean up everything the test created ───────────────────────────────────
console.log('\ncleaning up…');
const toDelete = new Set<number>();
if (aEntry !== null) toDelete.add(aEntry.id);
if (probe !== null) toDelete.add(probe.id);
try {
	const res = await client.request('/api/saves/delete', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ saves: [...toDelete] }),
	});
	console.log(`  delete → ${res.status}`);
} catch (err) {
	console.log(`  delete failed: ${String(err)}`);
}
const afterA = await getSaves(client, [ROM_A]);
const afterB = await getSaves(client, [ROM_B]);
check('rom A saveless again', (afterA?.length ?? 0) === 0, `${afterA?.length ?? 0} left`);
check('rom B saveless again', (afterB?.length ?? 0) === 0, `${afterB?.length ?? 0} left`);
const aladdin = await getSaves(client, [15]);
check('Aladdin autosave untouched', (aladdin?.length ?? 0) === 1, `${aladdin?.length ?? 0} saves`);

console.log(failures === 0 ? '\nall checks passed' : `\n${failures} check(s) FAILED`);
process.exit(failures === 0 ? 0 : 1);
