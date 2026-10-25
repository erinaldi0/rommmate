/**
 * Launching RetroArch from the app.
 *
 * The runtime's `Switch.Application` can start a homebrew NRO by path and
 * pass it command-line arguments:
 *
 *     new Switch.Application('sdmc:/switch/retroarch_switch.nro')
 *         .launch('-L', corePath, gamePath)
 *
 * The process *leaves* — `launch` is `never` — so the app's last act before
 * it is to write the pending-session marker (`saves/sync.ts` owns the
 * marker's contents; this module only performs the launch). When the user
 * comes home and re-opens RomMmate, the boot flow closes the session and
 * runs the save sync.
 *
 * In the browser preview there is no `Switch` global: the Play row reports
 * a clear "Switch only" status instead of crashing, so the rest of the
 * screen (and the screenshots of it) stay drivable.
 */
import { isSwitch } from './fs';
import { log } from './log';

interface SwitchApplicationLike {
	new (path: string): { launch(...args: string[]): never };
}

interface SwitchWebAppletLike {
	new (url: string): { start(options?: { hidden?: boolean }): Promise<void> };
}

interface SwitchLike {
	Application?: SwitchApplicationLike;
	WebApplet?: SwitchWebAppletLike;
}

declare const Switch: SwitchLike | undefined;

/** True when the runtime can actually start another application. */
export function canLaunch(): boolean {
	return isSwitch() && typeof Switch?.Application === 'function';
}

/**
 * Start RetroArch with a core and a game, booting straight into the game.
 *
 * @returns ok when the process is on its way; an error string when the
 *          launch could not even be attempted (off-device, or the loader
 *          is gone) — the process keeps running in that case.
 */
export function launchRetroArch(loaderPath: string, corePath: string, gamePath: string): {
	ok: boolean;
	error?: string;
} {
	if (!canLaunch()) {
		return { ok: false, error: 'launching needs the Switch runtime (browser preview cannot start apps)' };
	}
	try {
		log('launch', `retroarch loader=${loaderPath} core=${corePath} game=${gamePath}`);
		new Switch!.Application!(loaderPath).launch('-L', corePath, gamePath);
	} catch (err) {
		const message = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
		log('error', `launch: ${message}`);
		return { ok: false, error: message };
	}
	// `launch` is `never`: reaching here means it returned without leaving,
	// which the runtime documents as "the app will exit after this call".
	return { ok: true };
}

/**
 * Open the system browser on a page (the setup/doctor screen uses it to
 * take the user to the RomM web UI for the one-time uploads).
 *
 * @returns ok when the applet was started (it closes with the app), or an
 *          error string — the call itself never throws.
 */
export async function openWebApplet(url: string): Promise<{ ok: boolean; error?: string }> {
	if (!isSwitch() || typeof Switch?.WebApplet !== 'function') {
		return { ok: false, error: 'the browser applet needs the Switch runtime' };
	}
	try {
		await new Switch!.WebApplet!(url).start();
		return { ok: true };
	} catch (err) {
		const message = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
		log('error', `web applet: ${message}`);
		return { ok: false, error: message };
	}
}
