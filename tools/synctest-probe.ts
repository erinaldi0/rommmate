/** Dev-only probe: why does the inventory join / the download fail? */
import { RommClient } from '../src/romm';
import { freshManifest } from '../src/manifest';
import { writeBinary, readBinary, exists, listDir } from '../src/fs';
import { baseName, PATHS } from '../src/retroarch/layout';
import { localSaveFiles } from '../src/saves/inventory';
import { downloadSave } from '../src/saves/sync';

const client = new RommClient(process.argv[2] ?? '', process.argv[3] ?? '');

const fileB = '3 Games in One! - Yars\' Revenge + Asteroids + Pong (USA).zip';
const baseB = baseName(fileB);
console.log('baseB =', JSON.stringify(baseB));
console.log('savesDir =', PATHS.savesDir);

// 1. write + list + join
const A = new TextEncoder().encode('rommmate-probe-A\n');
await writeBinary(`${PATHS.savesDir}/${baseB}.srm`, A);
console.log('\nafter write:');
console.log('  exists file:', await exists(`${PATHS.savesDir}/${baseB}.srm`));
console.log('  listDir saves:', JSON.stringify((await listDir(PATHS.savesDir)) ?? null));

const manifest = freshManifest();
manifest.roms['3'] = {
	romId: 3,
	name: 'probe rom',
	platform: 'Atari 2600',
	platformId: 1,
	files: [],
	extractDirs: [],
	playPath: `sdmc:/switch/rommmate/roms/test/${fileB}`,
	outdated: false,
};
const files = await localSaveFiles(manifest);
for (const f of files) {
	console.log(`\ninventory: ${f.path}\n  base=${JSON.stringify(f.baseName)} romId=${f.romId} slot=${f.slot} size=${f.size}`);
}

// 2. the download sequence, traced (save 9 = the real Aladdin autosave, read-only)
const dest2 = `${PATHS.savesDir}/probe-download.srm`;
await downloadSave(client, 9, dest2);
console.log('  exists dest:', await exists(dest2));
const back = await readBinary(dest2);
console.log('  readBack:', back === null ? 'null' : `${back.byteLength} bytes`);
