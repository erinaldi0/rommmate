/**
 * On-device log file: `sdmc:/switch/rommate.log`.
 *
 * The app's `console` is the nx.js on-screen terminal (gone at reboot) and
 * the runtime's own diagnostics land in `sdmc:/nxjs-debug.log` — neither
 * is a file you can pull off the SD to see why a login failed. Connection
 * attempts append one line per event here instead, with the auth method
 * and base URL but never any secret.
 *
 * `Switch` only exists on-device: in the browser preview this is a no-op.
 * Logging is best-effort — a full or missing SD card must never take the
 * session down.
 */

const LOG_PATH = 'sdmc:/switch/rommate.log';

type Switchish = { appendFileSync?: (path: string, data: string) => void };

export function log(event: string, detail = ''): void {
	const line = `${new Date().toISOString()} ${event}${detail ? ` — ${detail}` : ''}\n`;
	try {
		(globalThis as { Switch?: Switchish }).Switch?.appendFileSync?.(LOG_PATH, line);
	} catch {
		/* best-effort only */
	}
}
