/**
 * Console network state, read from the OS before/at connect time.
 *
 * The Switch answers `getaddrinfo` in its network-root daemon, and it has
 * two observed failure modes: with no active connection the lookup fails
 * *before a single packet is sent* (`No address associated with
 * hostname`), and — with Wi-Fi up and DNS working — raw IPv4 literals are
 * still rejected outright (`Address family for hostname not supported`)
 * while DNS names resolve fine. Reading the IP config from nifm first
 * turns the "no network at all" case into an actionable message, and
 * records the console's own IP in the log so a remote debugging session
 * can see the subnet.
 *
 * `Switch` only exists on-device: in the browser preview every function
 * here says "no signal" and the connect flow proceeds untouched.
 */

type Switchish = {
	networkInfo?: () => { ip?: string };
};

export type NetStatus = {
	/** The console's IPv4 address, or null when unknown (off-device). */
	ip: string | null;
	/** A human message when the console clearly has no network. */
	problem: string | null;
};

export function networkStatus(): NetStatus {
	const sw = (globalThis as { Switch?: Switchish }).Switch;
	if (!sw?.networkInfo) return { ip: null, problem: null };
	try {
		// Throws (libnx error) when there is no IP configuration at all.
		const info = sw.networkInfo();
		const ip = info?.ip ?? '';
		if (ip === '' || ip === '0.0.0.0') {
			return { ip: null, problem: 'not connected to a network — check Wi-Fi in System Settings' };
		}
		return { ip, problem: null };
	} catch {
		return { ip: null, problem: 'not connected to a network — check Wi-Fi in System Settings' };
	}
}

/**
 * Turn the raw transport error into something actionable for the status
 * line. The unmodified error is always in `sdmc:/switch/rommmate/rommate.log`.
 */
export function friendlyNetworkError(raw: string): string {
	if (/address family/i.test(raw)) {
		return 'the Switch rejected a raw-IP address — use a DNS name in Base URL';
	}
	if (/no address associated/i.test(raw)) {
		return 'DNS lookup failed — check Internet Settings, then retry';
	}
	if (/refused/i.test(raw)) {
		return 'connection refused — is RomM running on that port?';
	}
	if (/timed? ?out/i.test(raw)) {
		return 'timed out — server not responding';
	}
	return raw;
}
