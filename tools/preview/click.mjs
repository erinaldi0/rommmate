#!/usr/bin/env node
/**
 * Dev-only: click on the preview canvas via CDP and read back what the app
 * did (the harness mirrors vk show/hide into document.title).
 *
 * usage: node tools/preview/click.mjs <x> <y> [url] [waitMs=3000] [port=9333] [shot.png]
 */
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';

const [x, y, url, waitArg, portArg, shot] = process.argv.slice(2);
if (!x || !y) {
	console.error('usage: node tools/preview/click.mjs <x> <y> [url] [waitMs] [port] [shot.png]');
	process.exit(2);
}
const pageUrl = url || 'http://localhost:8731/';
const waitMs = Number(waitArg ?? 3000);
const port = Number(portArg ?? 9333);

const chrome = spawn(
	'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
	[
		'--headless',
		'--disable-gpu',
		'--no-sandbox',
		`--remote-debugging-port=${port}`,
		'--window-size=1280,720',
		pageUrl,
	],
	{ stdio: 'ignore' },
);

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
	if (!target) throw new Error('no page target');

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

	await sleep(waitMs);

	const click = async (cx, cy) => {
		await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: cx, y: cy, button: 'left', clickCount: 1 });
		await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: cx, y: cy, button: 'left', clickCount: 1 });
	};

	await click(Number(x), Number(y));
	await sleep(800);

	const title = (await send('Runtime.evaluate', { expression: 'document.title' })).result.value;
	console.log('title after click:', JSON.stringify(title));
	if (shot) {
		const png = await send('Page.captureScreenshot', { format: 'png' });
		writeFileSync(shot, Buffer.from(png.data, 'base64'));
		console.log(`screenshot: ${shot}`);
	}
	ws.close();
} finally {
	chrome.kill('SIGKILL');
}
