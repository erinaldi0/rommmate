#!/usr/bin/env node
/**
 * Dev-only: drive the preview page in headless Chrome and report what the
 * page context says.
 *
 * Unlike `shot.mjs` (a picture), this collects console/log events while the
 * app runs and then evaluates expressions in the page, so a suspected
 * failure mode (a cover that never resolves, a rejected fetch) can be
 * confirmed with data instead of by squinting at pixels.
 *
 * usage: node tools/preview/probe.mjs <url> [waitMs=30000] [port=9334] [expr ...] [--shot out.png]
 */
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';

const args = process.argv.slice(2);
let shotPath = null;
const shotIdx = args.indexOf('--shot');
if (shotIdx !== -1) shotPath = args[shotIdx + 1];
const cleanArgs = shotIdx === -1 ? args : [...args.slice(0, shotIdx), ...args.slice(shotIdx + 2)];
const [url, waitArg, portArg, ...exprs] = cleanArgs;
if (!url) {
	console.error('usage: node probe.mjs <url> [waitMs] [port] [expr ...] [--shot out.png]');
	process.exit(2);
}
const waitMs = Number(waitArg ?? 30_000);
const port = Number(portArg ?? 9334);

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
	const logLines = [];
	ws.onmessage = (event) => {
		const msg = JSON.parse(event.data);
		if (msg.method === 'Runtime.consoleAPICalled') {
			const text = (msg.params.args ?? [])
				.map((a) => a.value ?? a.description ?? a.unserializableValue ?? '')
				.join(' ');
			consoleLines.push(`[${msg.params.type}] ${text.slice(0, 300)}`);
		} else if (msg.method === 'Runtime.exceptionThrown') {
			const d = msg.params.exceptionDetails;
			consoleLines.push(
				`[exception] ${d.text} ${d.exception?.description ?? ''}`.slice(0, 300),
			);
		} else if (msg.method === 'Log.entryAdded') {
			logLines.push(`${msg.params.entry.level}: ${msg.params.entry.text}`.slice(0, 300));
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
	await send('Log.enable');
	await send('Emulation.setDeviceMetricsOverride', {
		width: 1280,
		height: 720,
		deviceScaleFactor: 1,
		mobile: false,
	});

	await sleep(waitMs);

	for (const expr of exprs) {
		try {
			const result = await send('Runtime.evaluate', {
				expression: expr,
				returnByValue: true,
				awaitPromise: true,
			});
			const value = result.result?.value;
			console.log(`$ ${expr.slice(0, 80)}\n  = ${JSON.stringify(value)}`);
		} catch (err) {
			console.log(`$ ${expr.slice(0, 80)}\n  ! ${String(err)}`);
		}
	}

	if (shotPath) {
		const result = await send('Page.captureScreenshot', { format: 'png' });
		writeFileSync(shotPath, Buffer.from(result.data, 'base64'));
		console.log(`\nscreenshot -> ${shotPath}`);
	}

	console.log(`\nconsole events (${consoleLines.length}):`);
	for (const line of consoleLines.slice(-40)) console.log(`  ${line}`);
	console.log(`\nlog entries (${logLines.length}):`);
	for (const line of logLines.slice(-40)) console.log(`  ${line}`);

	ws.close();
} catch (err) {
	die(String(err));
} finally {
	chrome.kill('SIGKILL');
}
