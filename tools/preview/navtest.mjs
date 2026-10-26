#!/usr/bin/env node
/**
 * Dev-only: drive a navigation path through the preview harness and report
 * *where the focus ended up* — no pixels, just facts.
 *
 * `shot.mjs` gives a picture, but the thing a navigation audit actually needs
 * to check is "after these buttons, which target owns the focus?" — so this
 * walks the react-tela entity tree instead of squinting at a screenshot:
 *
 *   - the accent-stroked entities (the focus ring / focused rows / chips),
 *     with their geometry, and
 *   - the input trace the harness mirrors into the document title
 *     (button presses + the view's action callbacks, e.g. `section:platform`).
 *
 * usage: node tools/preview/navtest.mjs <url> [waitMs=3500] [port=9336]
 *
 * The URL is the preview page with its knobs, e.g.
 *   http://127.0.0.1:8932/tools/preview/index.html?view=sections&sim=Down,Right
 */
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';

const [url, waitArg, portArg] = process.argv.slice(2);
if (!url) {
	console.error('usage: node navtest.mjs <url> [waitMs] [port]');
	process.exit(2);
}
const waitMs = Number(waitArg ?? 3500);
const port = Number(portArg ?? 9336);

const chrome = spawn(
	'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
	[
		'--headless',
		'--disable-gpu',
		'--no-sandbox',
		`--remote-debugging-port=${port}`,
		'--window-size=1280,720',
		url,
	],
	{ stdio: 'ignore' },
);

const die = (msg) => {
	console.error(msg);
	chrome.kill('SIGKILL');
	process.exit(1);
};

try {
	let target;
	for (let i = 0; i < 100; i++) {
		try {
			const res = await fetch(`http://127.0.0.1:${port}/json`);
			const targets = await res.json();
			target = targets.find((t) => t.type === 'page' && t.url !== 'about:blank');
			if (target) break;
		} catch {
			/* Chrome is still coming up */
		}
		await sleep(100);
	}
	if (!target) die('no page target');

	const ws = new WebSocket(target.webSocketDebuggerUrl);
	await new Promise((res, rej) => {
		ws.onopen = res;
		ws.onerror = () => rej(new Error('devtools websocket failed'));
	});

	let nextId = 0;
	const pending = new Map();
	const consoleLines = [];
	ws.onmessage = (event) => {
		const msg = JSON.parse(event.data);
		if (msg.method === 'Runtime.consoleAPICalled') {
			const text = (msg.params.args ?? [])
				.map((a) => a.value ?? a.description ?? '')
				.join(' ');
			consoleLines.push(`[${msg.params.type}] ${text.slice(0, 200)}`);
		} else if (msg.method === 'Runtime.exceptionThrown') {
			const d = msg.params.exceptionDetails;
			consoleLines.push(`[exception] ${(d.exception?.description ?? d.text).slice(0, 300)}`);
		} else if (msg.id !== undefined && pending.has(msg.id)) {
			pending.get(msg.id)(msg);
			pending.delete(msg.id);
		}
	};
	const send = (method, params = {}) =>
		new Promise((resolve, reject) => {
			const id = ++nextId;
			pending.set(id, (m) =>
				m.error ? reject(new Error(`${method}: ${m.error.message}`)) : resolve(m.result),
			);
			ws.send(JSON.stringify({ id, method, params }));
		});

	await send('Page.enable');
	await send('Runtime.enable');
	await send('Emulation.setDeviceMetricsOverride', {
		width: 1280,
		height: 720,
		deviceScaleFactor: 1,
		mobile: false,
	});

	await sleep(waitMs);

	/*
	 * The focus probe: every focusable surface in the app marks focus with
	 * the accent (#7895FF) — the FocusRing's stroke, a focused row/chip's
	 * stroke — so the accent-stroked entities *are* the focus map. Text
	 * entities are collected too, so a report can name the thing the ring
	 * is around (the label inside the ring's bounds).
	 */
	const FOCUS_PROBE = `(() => {
		const root = window.__root;
		if (!root) return { error: 'no __root' };
		const texts = [];
		const rings = [];
		for (const e of root.entities) {
			if (typeof e.value === 'string') {
				texts.push({ x: e.x, y: e.y, s: e.value.slice(0, 48) });
			} else if (e.stroke === '#7895FF') {
				rings.push({
					x: e.x, y: e.y, w: e.width, h: e.height,
					lw: e.lineWidth, glow: e.shadowBlur || 0,
					fill: e.fill || '',
					text: texts
						.filter((t) => t.x >= e.x - 2 && t.x <= e.x + e.width + 2 &&
							t.y >= e.y - 2 && t.y <= e.y + e.height + 2)
						.map((t) => t.s).join(' | ').slice(0, 60),
				});
			}
		}
		return { rings, trace: document.title };
	})()`;

	const result = await send('Runtime.evaluate', {
		expression: FOCUS_PROBE,
		returnByValue: true,
	});
	const value = result.result?.value ?? { error: result.result?.description };
	console.log(JSON.stringify(value, null, 1));

	if (consoleLines.length > 0) {
		console.log(`\nconsole (${consoleLines.length}):`);
		for (const line of consoleLines.slice(-12)) console.log(`  ${line}`);
	}
	ws.close();
	chrome.kill('SIGKILL');
} catch (err) {
	die(String(err));
}
