/**
 * RomM NetTest — standalone networking debug tool for RomMmate.
 *
 * Isolates the Switch's network stack from the RomMmate app entirely, and
 * meters each layer separately so a failure names itself:
 *
 *   [1] console network config (nifm)      — is Wi-Fi up at all?
 *   [2] subnet note                        — is the target on this subnet?
 *   [3] resolveDns(target host)            — raw-IP literal path (the bug)
 *   [4] resolveDns(server DNS name)        — DuckDNS name (the workaround)
 *   [5] resolveDns("example.com")          — DNS vs internet sanity
 *   [6] UDP socket + DNS query (raw)       — socket layer? (opt-in: udp=1)
 *   [7] TCP connect dns-name:port (5s)     — the "ping": is the server up?
 *   [8] TCP connect raw-ip:port (5s)       — same, via the rejected literal
 *   [9] HTTP GET http://dns-name:port/     — full stack round-trip
 *  [10] HTTP POST /api/client-tokens/exchange — rommmate's exact request path
 *  [11] HTTPS GET example.com              — WAN reachability (informational)
 *
 * There is no ICMP ping available to nx.js apps, so "ping" here means a TCP
 * connect to the RomM port — a RST (connection refused) still proves the host
 * answered, which is what we actually want to know.
 *
 * Config (optional), one `key=value` per line in `sdmc:/switch/romm-test.txt`:
 *
 *   host=10.147.18.46      # target host (IP or name)
 *   port=8200              # target port (shared by all target stages)
 *   name=harinaldibologna.duckdns.org  # the server's DNS name
 *   udp=1                  # opt-in: raw UDP socket probe (stage 6)
 *   url=HTTP://10.147.18.46:8200   # printed as context (verbatim user input)
 *
 * The UDP probe (udp=1) hard-crashed the process under Ryujinx's
 * incomplete bsd socket emulation (the log stops mid-stage, no JS error),
 * so it is OFF by default — only enable it on real hardware when the TCP
 * stages say "everything refused" and you want to know if UDP dies too.
 *
 * Defaults: host=10.147.18.46 port=8200 name=harinaldibologna.duckdns.org
 * (the server this tool was built for). Stages [4]/[6]/[8]/[9] use the DNS
 * name, because the OS currently rejects raw IP literals (stage [3]).
 * Everything printed on screen is also appended to
 * `sdmc:/switch/romm-test.log`, one timestamped line per entry.
 *
 * Controls: after a run, release all buttons, then press any button to run
 * again, or + to exit. No build step — edit romfs/main.js and re-run
 * `npm run nro:nettest` from the repo root.
 */

const LOG_PATH = 'sdmc:/switch/romm-test.log';
const CFG_PATH = 'sdmc:/switch/romm-test.txt';
const DEFAULT_HOST = '10.147.18.46';
const DEFAULT_PORT = 8200;
// DNS name for DEFAULT_HOST — names resolve while raw literals don't.
const DEFAULT_NAME = 'harinaldibologna.duckdns.org';
const RESOLVE_MS = 5000;
const CONNECT_MS = 5000;
const HTTP_MS = 8000;

/** Mirror of @nx.js/constants AppletType (the nettest has no imports). */
const APPLET_TYPES = {
	'-2': 'None',
	'-1': 'Default',
	0: 'Application',
	1: 'SystemApplet',
	2: 'LibraryApplet',
	3: 'OverlayApplet',
	4: 'SystemApplication',
};

/** Error text without the useless "Error:" prefix when name is generic. */
function errText(err) {
	const message = err?.message ?? String(err);
	const name = err?.name;
	return name && name !== 'Error' ? `${name}: ${message}` : message;
}

function out(line) {
	console.log(line);
	try {
		(globalThis.Switch)?.appendFileSync(LOG_PATH, `${new Date().toISOString()} ${line}\n`);
	} catch {
		/* the log is best-effort; the screen output already happened */
	}
}

/** Reject with an Error after `ms`, and release the timer so the loop drains. */
function withTimeout(promise, ms, what) {
	let timer;
	const timeout = new Promise((_, reject) => {
		timer = setTimeout(() => reject(new Error(`timed out after ${ms}ms — ${what}`)), ms);
	});
	return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function ipToInt(ip) {
	const parts = String(ip).split('.');
	if (parts.length !== 4) return null;
	let value = 0;
	for (const part of parts) {
		const n = Number(part);
		if (!Number.isInteger(n) || n < 0 || n > 255) return null;
		value = (value * 256 + n) >>> 0;
	}
	return value;
}

function sameSubnet(ip, mask, target) {
	const i = ipToInt(ip);
	const m = ipToInt(mask);
	const t = ipToInt(target);
	if (i === null || m === null || t === null) return null;
	return ((i & m) >>> 0) === ((t & m) >>> 0);
}

/** Minimal DNS query packet: A record for `name`, transaction id `id`. */
function dnsQueryPacket(name, id) {
	const parts = [(id >> 8) & 0xff, id & 0xff, 0x01, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x00];
	for (const label of name.split('.')) {
		parts.push(label.length);
		for (let i = 0; i < label.length; i++) parts.push(label.charCodeAt(i));
	}
	parts.push(0x00, 0x00, 0x01, 0x00, 0x01); // root, type A, class IN
	return new Uint8Array(parts);
}

/** Parse a DNS reply: `{ answers, ip }` (first A record) or null. */
function parseDnsReply(buf) {
	const b = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
	if (b.length < 12) return null;
	const flags = (b[2] << 8) | b[3];
	if ((flags & 0x8000) === 0) return null; // QR bit: must be a response
	const qd = (b[4] << 8) | b[5];
	const an = (b[6] << 8) | b[7];
	let off = 12;
	const skipName = () => {
		while (off < b.length) {
			const len = b[off];
			if (len === 0) {
				off += 1;
				return;
			}
			if ((len & 0xc0) === 0xc0) {
				off += 2;
				return;
			}
			off += 1 + len;
		}
	};
	for (let i = 0; i < qd; i++) {
		skipName();
		off += 4;
	}
	let ip = null;
	for (let i = 0; i < an && off + 12 <= b.length; i++) {
		skipName();
		const type = (b[off] << 8) | b[off + 1];
		const rdlen = (b[off + 10] << 8) | b[off + 11];
		off += 12;
		if (type === 1 && rdlen === 4 && off + 4 <= b.length && ip === null) {
			ip = `${b[off]}.${b[off + 1]}.${b[off + 2]}.${b[off + 3]}`;
		}
		off += rdlen;
	}
	return { answers: an, ip };
}

async function loadConfig() {
	const cfg = {
		host: DEFAULT_HOST,
		port: DEFAULT_PORT,
		name: DEFAULT_NAME,
		udp: false,
		url: null,
		source: 'built-in default',
	};
	let text = '';
	try {
		const buf = await globalThis.Switch.readFile(CFG_PATH);
		if (buf) text = new TextDecoder().decode(buf);
	} catch {
		/* unreadable config behaves like no config */
	}
	if (text) {
		cfg.source = CFG_PATH;
		for (const rawLine of text.split('\n')) {
			const line = rawLine.trim();
			if (!line || line.startsWith('#')) continue;
			const eq = line.indexOf('=');
			if (eq === -1) continue;
			const key = line.slice(0, eq).trim().toLowerCase();
			const value = line.slice(eq + 1).trim();
			if (key === 'host' && value !== '') cfg.host = value;
			else if (key === 'name' && value !== '') cfg.name = value;
			else if (key === 'port') {
				const n = Number(value);
				if (Number.isInteger(n) && n > 0 && n <= 65535) cfg.port = n;
			} else if (key === 'url' && value !== '') cfg.url = value;
			else if (key === 'udp') cfg.udp = /^(1|on|true|yes)$/i.test(value);
		}
	}
	if (!cfg.url) cfg.url = `http://${cfg.host}:${cfg.port}`;
	// Mirror rommmate: strip trailing slashes so path joins stay single.
	cfg.url = cfg.url.replace(/\/+$/, '');
	return cfg;
}

async function run() {
	const hints = [];
	let ok = 0;
	let total = 0;

	const hint = (msg) => {
		if (!hints.includes(msg)) hints.push(msg);
	};

	// `total` counts the metered stages only ([3]..[11]); [1]/[2] are context.
	const stage = async (n, label, fn) => {
		total += 1;
		const start = Date.now();
		out(`[${n}] ${label}`);
		try {
			const detail = await fn();
			ok += 1;
			out(`    ok (${Date.now() - start}ms)${detail ? ` — ${detail}` : ''}`);
			return detail;
		} catch (err) {
			const text = errText(err);
			out(`    ERROR — ${text}`);
			if (/no more processes|resource temporarily unavailable/i.test(text)) {
				hint('socket resources exhausted (EAGAIN) — close other homebrew and re-run; a second run usually clears it');
			}
			return null;
		}
	};

	out('=== RomM NetTest ===');
	out(`run: ${new Date().toISOString()}`);
	try {
		const rawType = globalThis.Switch.appletType();
		const typeName = APPLET_TYPES[rawType];
		out(`mode: ${typeName ? `${typeName} (${String(rawType)})` : String(rawType)}`);
	} catch {
		/* older runtime */
	}

	const cfg = await loadConfig();
	out(`target: ${cfg.host}:${cfg.port}`);
	out(`base: ${cfg.url}`);
	out(`config: ${cfg.source}`);

	// [1] Network configuration — throws outright when Wi-Fi is down.
	let net = null;
	await stage(1, 'console network config', async () => {
		net = globalThis.Switch.networkInfo();
		const dns = net.primaryDnsServer ? ` dns=${net.primaryDnsServer}` : ' dns=n/a';
		return `ip=${net.ip} mask=${net.subnetMask} gw=${net.gateway}${dns}`;
	});
	if (net === null) {
		hints.push('no IP config — connect Wi-Fi in System Settings');
	}

	// [2] Subnet context — a routed (different-subnet) target is legal but
	// is the classic "works from my PC, not from the Switch" trap. The
	// check counts as a stage: it *completed* whenever we have a console IP,
	// even when the answer is "different subnet" (that's a hint, not a fail).
	out('[2] target vs console subnet');
	total += 1;
	if (net) {
		ok += 1;
		const match = sameSubnet(net.ip, net.subnetMask, cfg.host);
		if (match === true) {
			out('    note — target is on this subnet');
		} else if (match === false) {
			out('    note — target NOT in console\'s subnet (LAN routing needed)');
			hints.push('different subnet — server must be reachable by routing, not just same-Wi-Fi');
		} else {
			out('    note — target is a hostname; subnet check needs an IP');
		}
	} else {
		out('    skipped — no console IP to compare');
	}

	// [3] Raw IP literals — RomMmate's current on-device failure: the OS
	// resolver rejects numeric hosts (EAI_ADDRFAMILY) even though DNS
	// names resolve fine, so Base URL must use a name, not an IP.
	const resolved = await stage(3, `resolveDns("${cfg.host}")`, async () => {
		const addrs = await withTimeout(
			globalThis.Switch.resolveDns(cfg.host),
			RESOLVE_MS,
			'resolveDns',
		);
		if (!addrs || addrs.length === 0) throw new Error('no addresses returned');
		return addrs.join(', ');
	});
	if (resolved === null) {
		if (ipToInt(cfg.host) !== null) {
			hint('raw IP literals are rejected by the Switch resolver — put a DNS name in RomMmate\'s Base URL');
		} else {
			hint('the target hostname does not resolve — see [4]/[5] to tell "this name" from "all DNS"');
		}
	}

	// [4] The server's DNS name — the path RomMmate should take, and proof
	// of what address the name actually points at.
	let nameAddrs = null;
	const nameOk = await stage(4, `resolveDns("${cfg.name}")`, async () => {
		const addrs = await withTimeout(
			globalThis.Switch.resolveDns(cfg.name),
			RESOLVE_MS,
			'resolveDns',
		);
		if (!addrs || addrs.length === 0) throw new Error('no addresses returned');
		nameAddrs = addrs;
		return addrs.join(', ');
	});
	if (nameOk === null) {
		hint(`cannot resolve ${cfg.name} — check the name itself (a PC should resolve it too)`);
	} else if (nameAddrs && ipToInt(cfg.host) !== null && !nameAddrs.includes(cfg.host)) {
		out(`    note — ${cfg.name} points at ${nameAddrs.join(', ')}, NOT the configured ${cfg.host}`);
	}

	// [5] Well-known name — separates "resolver broken" from "no internet".
	await stage(5, 'resolveDns("example.com")', async () => {
		const addrs = await withTimeout(
			globalThis.Switch.resolveDns('example.com'),
			RESOLVE_MS,
			'resolveDns',
		);
		if (!addrs || addrs.length === 0) throw new Error('no addresses returned');
		return addrs.join(', ');
	});

	// [6] UDP probe — OPT-IN (`udp=1`): opens a UDP socket and does a real
	// DNS round-trip to the console's own DNS server. Separates "TCP
	// sockets refused" from "the whole socket layer is down". Off by
	// default: it hard-crashed the process under Ryujinx's incomplete bsd
	// socket emulation (log stops mid-stage, no JS error).
	let udpOk = false;
	const dnsServer = net?.primaryDnsServer ?? '';
	if (!cfg.udp) {
		out('[6] UDP socket probe — skipped (opt-in: set udp=1 in romm-test.txt)');
	} else {
		await stage(6, `UDP socket + DNS query to ${dnsServer || 'dns'}:53`, async () => {
			if (!dnsServer) throw new Error('no DNS server known (stage 1 failed)');
			const sock = globalThis.Switch.listenDatagram({ port: 0 });
			try {
				const reply = new Promise((resolve, reject) => {
					const timer = setTimeout(
						() => reject(new Error('no UDP reply within 3000ms')),
						3000,
					);
					sock.addEventListener(
						'message',
						(e) => {
							clearTimeout(timer);
							resolve(e.data);
						},
						{ once: true },
					);
				});
				await sock.send(dnsQueryPacket('example.com', 0x4e54), dnsServer, 53);
				const parsed = parseDnsReply(await reply);
				if (!parsed) throw new Error('UDP reply was not a DNS response');
				udpOk = true;
				return `reply from ${dnsServer} — ${parsed.answers} answer(s)${parsed.ip ? ` (${parsed.ip})` : ''}`;
			} finally {
				try {
					sock.close();
				} catch {
					/* already closed */
				}
			}
		});
		if (!udpOk) {
			hint('UDP probe failed too — if its error is EAGAIN, the whole socket layer is down: reboot the console, then re-run');
		}
	}

	// [7] The actual ping to the RomM server, by DNS name: refused/
	// unreachable/timeout all answer "is the connection up?" differently.
	const tcp = await stage(7, `TCP connect ${cfg.name}:${cfg.port}`, async () => {
		const socket = globalThis.Switch.connect({ hostname: cfg.name, port: cfg.port });
		try {
			const info = await withTimeout(socket.opened, CONNECT_MS, 'TCP connect');
			return `local=${info.localAddress} remote=${info.remoteAddress}`;
		} finally {
			try {
				socket.close();
			} catch {
				/* already closed */
			}
		}
	});
	if (tcp !== null) {
		hint(`server reachable by DNS name — use http://${cfg.name}:${cfg.port} as RomMmate's Base URL`);
	} else if (nameOk !== null) {
		hint('name resolves but the connection failed — server down/wrong port, or its network not routable from the Switch');
	}

	// [8] Same connect via the raw literal — expected to fail while [3]
	// fails; kept as the record of RomMmate's exact current config.
	await stage(8, `TCP connect ${cfg.host}:${cfg.port} (raw IP)`, async () => {
		const socket = globalThis.Switch.connect({ hostname: cfg.host, port: cfg.port });
		try {
			const info = await withTimeout(socket.opened, CONNECT_MS, 'TCP connect');
			return `local=${info.localAddress} remote=${info.remoteAddress}`;
		} finally {
			try {
				socket.close();
			} catch {
				/* already closed */
			}
		}
	});

	// [9] Full-stack HTTP round-trip via the DNS name.
	const nameUrl = `http://${cfg.name}:${cfg.port}`;
	await stage(9, `HTTP GET ${nameUrl}/`, async () => {
		const res = await fetch(`${nameUrl}/`, {
			signal: globalThis.AbortSignal.timeout(HTTP_MS),
		});
		if (res.body) {
			try {
				await res.body.cancel();
			} catch {
				/* body irrelevant; connection will close anyway */
			}
		}
		return `HTTP ${res.status} ${res.statusText}`;
	});

	// [10] RomMmate's exact request via the DNS name: any HTTP reply at all
	// (even 4xx/404) proves the full path the login uses is working.
	await stage(10, `POST ${nameUrl}/api/client-tokens/exchange`, async () => {
		const res = await fetch(`${nameUrl}/api/client-tokens/exchange`, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ code: 'NETTEST' }),
			signal: globalThis.AbortSignal.timeout(HTTP_MS),
		});
		if (res.body) {
			try {
				await res.body.cancel();
			} catch {
				/* ditto */
			}
		}
		return `HTTP ${res.status} ${res.statusText} (any reply = full path works)`;
	});

	// [11] Informational only — WAN access, irrelevant to a LAN RomM box.
	await stage(11, 'HTTPS GET example.com (info)', async () => {
		const res = await fetch('https://example.com/', {
			signal: globalThis.AbortSignal.timeout(HTTP_MS),
		});
		if (res.body) {
			try {
				await res.body.cancel();
			} catch {
				/* ditto */
			}
		}
		return `HTTP ${res.status}`;
	});

	out('---');
	out(`stages ok: ${ok}/${total}`);
	for (const hint of hints) out(`hint: ${hint}`);
	out('release buttons, then press any button to re-run · + to exit');
}

let running = false;
let armed = false; // require a full release before a press counts (hbmenu's A)

async function startRun() {
	if (running) return;
	running = true;
	try {
		await run();
	} catch (err) {
		out(`FATAL — ${errText(err)}`);
	} finally {
		running = false;
	}
}

function frame() {
	try {
		const pads = globalThis.navigator?.getGamepads?.() ?? [];
		let pressed = false;
		let plus = false;
		for (const pad of pads) {
			if (!pad) continue;
			for (let i = 0; i < pad.buttons.length; i++) {
				if (!pad.buttons[i]?.pressed) continue;
				pressed = true;
				if (i === 9) plus = true;
			}
		}
		if (plus) globalThis.Switch.exit();
		if (!pressed) armed = true;
		else if (armed && !running) {
			armed = false;
			startRun();
		}
	} catch {
		/* input must never kill the loop */
	}
	globalThis.requestAnimationFrame(frame);
}

globalThis.requestAnimationFrame(frame);
startRun();
