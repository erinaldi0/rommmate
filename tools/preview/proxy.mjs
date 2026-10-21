#!/usr/bin/env node
/**
 * CORS proxy for the browser preview harness.
 *
 * A real RomM instance answers browser requests without an
 * `access-control-allow-origin` header, so the preview (Chrome) cannot fetch
 * from it directly — the app on the Switch is unaffected, because nx.js's
 * fetch is not subject to CORS. This tiny proxy adds the CORS headers and
 * streams everything else through to the instance, so the preview can
 * browse a real library with its real artwork.
 *
 * Usage:
 *   node tools/preview/proxy.mjs [targetBaseUrl] [port]
 *
 * `targetBaseUrl` defaults to the `url` from the repo's `.env`; `port`
 * defaults to 8732. Then point the preview at it:
 *
 *   http://localhost:8731/index.html?base=http://localhost:8732&token=<from .env>
 *
 * Dev-only: it logs every request to stdout and trusts anything local.
 */
import http from 'node:http';
import https from 'node:https';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

/** The `url` line of the repo's `.env`, if present. */
function targetFromDotEnv() {
	try {
		const text = readFileSync(path.resolve(here, '../../.env'), 'utf8');
		const m = /^url\s*=\s*(\S+)/m.exec(text);
		if (m) return m[1].replace(/\/+$/, '');
	} catch {
		// no .env — the caller must pass the target explicitly
	}
	return null;
}

const target = (process.argv[2] ?? targetFromDotEnv() ?? '').replace(/\/+$/, '');
if (target === '') {
	console.error('usage: node proxy.mjs [targetBaseUrl] [port]');
	console.error('(or set `url = …` in the repo .env)');
	process.exit(1);
}

const upstreamUrl = new URL(target);
const upstreamPort = upstreamUrl.port !== '' ? Number(upstreamUrl.port) : undefined;
const upstreamHost = upstreamUrl.hostname;
const httpOrHttps = upstreamUrl.protocol === 'https:' ? https : http;

const port = Number(process.argv[3] ?? process.env.PORT ?? 8732);

// Hop-by-hop headers are re-negotiated by each hop and must not be copied.
const HOP_BY_HOP = new Set([
	'connection',
	'keep-alive',
	'proxy-authenticate',
	'proxy-authorization',
	'te',
	'trailer',
	'trailers',
	'transfer-encoding',
	'upgrade',
]);

function cleanRequestHeaders(req) {
	const headers = {};
	for (const [k, v] of Object.entries(req.headers)) {
		if (HOP_BY_HOP.has(k.toLowerCase())) continue;
		if (k === 'host') continue; // replaced with the upstream host below
		headers[k] = v;
	}
	return headers;
}

function cleanResponseHeaders(up) {
	const headers = {};
	for (const [k, v] of Object.entries(up.headers)) {
		if (HOP_BY_HOP.has(k.toLowerCase())) continue;
		if (k === 'set-cookie' || k === 'set-cookie2') continue;
		if (k === 'content-length') continue; // res re-chunks; a stale length would lie
		headers[k] = v;
	}
	return headers;
}

const server = http.createServer((req, res) => {
	// The preview origin varies, so `*` — the app's fetches never carry
	// cookies, and `covers.ts` does not set `credentials: 'include'`.
	res.setHeader('access-control-allow-origin', '*');
	res.setHeader(
		'access-control-allow-methods',
		'GET, HEAD, OPTIONS, POST, PUT, DELETE, PATCH',
	);
	res.setHeader(
		'access-control-allow-headers',
		req.headers['access-control-request-headers'] || 'authorization, accept, content-type',
	);
	res.setHeader('access-control-max-age', '600');
	res.setHeader('vary', 'Origin');

	if (req.method === 'OPTIONS') {
		res.writeHead(204);
		res.end();
		return;
	}

	const started = Date.now();
	const up = httpOrHttps.request(
		{
			protocol: upstreamUrl.protocol,
			host: upstreamHost,
			port: upstreamPort,
			path: req.url, // as sent by the client, query string included
			method: req.method,
			headers: cleanRequestHeaders(req),
		},
		(upRes) => {
			let bytes = 0;
			res.writeHead(upRes.statusCode ?? 502, cleanResponseHeaders(upRes));
			upRes.on('data', (chunk) => {
				bytes += chunk.length;
				res.write(chunk);
			});
			upRes.on('end', () => {
				res.end();
				const ms = Date.now() - started;
				console.log(
					`[proxy] ${req.method} ${req.url.slice(0, 120)} -> ${upRes.statusCode} ${bytes}b ${ms}ms`,
				);
			});
			upRes.on('error', (err) => {
				console.log(`[proxy] upstream error: ${err.message}`);
				res.end();
			});
		},
	);

	up.on('error', (err) => {
		console.log(`[proxy] cannot reach upstream ${upstreamUrl.origin}: ${err.message}`);
		if (!res.headersSent) {
			res.writeHead(502, { 'content-type': 'text/plain' });
		}
		res.end(`upstream error: ${err.message}`);
	});

	req.on('error', () => up.destroy());
	req.pipe(up);
});

server.listen(port, () => {
	console.log(`[proxy] ${upstreamUrl.origin}  ->  http://localhost:${port}  (CORS *)`);
});
