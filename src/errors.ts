/**
 * Global error capture.
 *
 * react-tela paints the scene from a microtask, outside React's render phase,
 * so a React error boundary cannot observe a failure that happens while
 * drawing. These helpers trap uncaught errors and promise rejections and hand
 * them to the app, which shows them on screen instead of leaving the user
 * staring at a half-drawn frame.
 */

import { memSnapshot } from './mem';

type Listener = (message: string) => void;

let fatalMessage: string | null = null;
const listeners = new Set<Listener>();

function describe(err: unknown): string {
	if (err instanceof Error) return `${err.name}: ${err.message}`;
	if (typeof err === 'string') return err;
	try {
		return JSON.stringify(err) ?? String(err);
	} catch {
		return String(err);
	}
}

export function getFatalMessage(): string | null {
	return fatalMessage;
}

/** Records the first fatal error and notifies every listener. */
export function reportFatalError(err: unknown): void {
	if (fatalMessage !== null) return;
	// The memory gauges at the moment of failure: a native malloc shortage
	// (whoever allocated last) and the heap the JS side held — the single
	// most useful number for an OOM report, on screen where every report
	// has it.
	let mem = '';
	try {
		mem = `\n\nmemory: ${memSnapshot()}`;
	} catch {
		/* the snapshot must never mask the error */
	}
	fatalMessage = describe(err) + mem;
	for (const listener of listeners) listener(fatalMessage);
}

/** Subscribes to fatal errors. Returns an unsubscribe function. */
export function onFatalError(listener: Listener): () => void {
	listeners.add(listener);
	if (fatalMessage !== null) listener(fatalMessage);
	return () => {
		listeners.delete(listener);
	};
}

/**
 * Installs the global `error` / `unhandledrejection` handlers.
 *
 * The default nx.js behaviour for an uncaught error is to dump it to the
 * console and tell the user to press + to exit — useless for a canvas app
 * that owns the screen, so the default is suppressed and the error is
 * surfaced in the UI instead.
 */
export function installErrorTrap(): void {
	try {
		globalThis.addEventListener?.('error', (event: Event) => {
			event.preventDefault?.();
			const e = event as ErrorEvent;
			reportFatalError(e.error ?? e.message ?? e.type);
		});
		globalThis.addEventListener?.('unhandledrejection', (event: Event) => {
			event.preventDefault?.();
			const e = event as PromiseRejectionEvent;
			reportFatalError(e.reason);
		});
	} catch {
		/* no global event target in this environment — nothing to trap */
	}
}
