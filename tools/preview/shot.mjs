#!/usr/bin/env node
/**
 * Dev-only: screenshot the preview at a chosen *real-time* offset, via the
 * Chrome DevTools Protocol.
 *
 * The `--screenshot` CLI flag only fires once the page's *virtual* clock has
 * exhausted its budget — which never happens while a fetch is in flight,
 * because virtual time pauses. This waits in real time instead, so a state
 * that depends on a slow network request (a cover mid-download, for one)
 * can be captured.
 *
 * usage: node tools/preview/shot.mjs <url> <out.png> [waitMs=2500] [port=9333]
 */
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';

const [url, out, waitArg, portArg] = process.argv.slice(2);
if (!url || !out) {
	console.error('usage: node tools/preview/shot.mjs <url> <out.png> [waitMs] [port]');
	process.exit(2);
}
const waitMs = Number(waitArg ?? 2500);
const port = Number(portArg ?? 9333);

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
	// Wait for the DevTools endpoint and the page target.
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
	ws.onmessage = (event) => {
		const msg = JSON.parse(event.data);
		if (msg.id !== undefined && pending.has(msg.id)) {
			pending.get(msg.id)(msg);
			pending.delete(msg.id);
		}
	};
	const send = (method, params = {}) =>
		new Promise((resolve, reject) => {
			const id = ++nextId;
			pending.set(id, (msg) =>
				msg.error ? reject(new Error(`${method}: ${msg.error.message}`)) : resolve(msg.result),
			);
			ws.send(JSON.stringify({ id, method, params }));
		});

	await send('Page.enable');
	await send('Emulation.setDeviceMetricsOverride', {
		width: 1280,
		height: 720,
		deviceScaleFactor: 1,
		mobile: false,
	});

	// Let real time pass: this is the whole point of the tool.
	await sleep(waitMs);

	const shot = await send('Page.captureScreenshot', { format: 'png' });
	writeFileSync(out, Buffer.from(shot.data, 'base64'));
	ws.close();
	console.log(`${out} after ${waitMs} ms`);
} catch (err) {
	die(String(err));
} finally {
	chrome.kill('SIGKILL');
}
