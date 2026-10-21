/**
 * Build identity, injected at bundle time by `tools/build.mjs`.
 *
 * The value is shown in the app header so that a single screenshot is enough
 * to tell which build is running on the device. Bundles produced without the
 * define (e.g. the browser preview harness) fall back to `dev`.
 */
declare const __ROMMMATE_BUILD__: string | undefined;

export const BUILD_ID: string =
	typeof __ROMMMATE_BUILD__ === 'string' ? __ROMMMATE_BUILD__ : 'dev';
