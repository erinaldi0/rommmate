/**
 * Device identity: the stable "who is this console" the server ties saves,
 * sync sessions and play sessions to.
 *
 * Registered once (`POST /api/devices`), then the uuid is remembered in
 * the manifest (and mirrored in localStorage as a second copy — the
 * manifest is an SD file, localStorage is Save Data; either surviving is
 * enough). The registration uses `allow_existing`, so re-registering with
 * the same name is cheap and self-healing.
 */
import { registerDevice } from '../romm/play';
import type { RommClient } from '../romm';
import { saveManifest, type Manifest } from '../manifest';
import { BUILD_ID } from '../version';
import { log } from '../log';

const LS_DEVICE = 'rommate.deviceId';

/** The name the server shows for this console. */
const DEVICE_NAME = 'Switch (RomMmate)';

function lsGet(key: string): string | null {
	try {
		return localStorage?.getItem(key) ?? null;
	} catch {
		return null;
	}
}

function lsSet(key: string, value: string): void {
	try {
		localStorage?.setItem(key, value);
	} catch {
		/* Save Data unavailable — the manifest copy still works */
	}
}

/**
 * A device id to sync under: the remembered one, else a fresh
 * registration.
 *
 * @returns the uuid, or null when the server predates the route (the
 *          sync layer then treats sync as unavailable).
 */
export async function ensureDevice(
	client: RommClient,
	manifest: Manifest,
	signal?: AbortSignal,
): Promise<string | null> {
	if (manifest.deviceId !== null) {
		return manifest.deviceId;
	}
	const mirrored = lsGet(LS_DEVICE);
	if (mirrored !== null && mirrored !== '') {
		manifest.deviceId = mirrored;
		await saveManifest(manifest);
		return mirrored;
	}

	const device = await registerDevice(
		client,
		{
			name: DEVICE_NAME,
			platform: 'Switch',
			client: 'rommmate',
			clientVersion: BUILD_ID,
			syncMode: 'api',
		},
		signal,
	);
	if (device === null) {
		log('error', 'device registration failed (sync unavailable)');
		return null;
	}
	manifest.deviceId = device.id;
	lsSet(LS_DEVICE, device.id);
	await saveManifest(manifest);
	log('device', `registered ${device.id}`);
	return device.id;
}
