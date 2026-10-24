# RomM NetTest

A minimal, standalone nx.js NRO that meters the Switch's network stack layer
by layer — built to debug why RomMmate can't reach a RomM server. It contains
zero RomMmate code, so a failure here is the OS/network, and a pass here with
a RomMmate failure is the app.

## What it tests

| # | Stage | Answers |
|---|-------|---------|
| 1 | `Switch.networkInfo()` (nifm) | Is Wi-Fi up? What IP/mask/gateway/DNS does the console have? |
| 2 | target vs console subnet | Is the server on this subnet, or does routing have to happen? |
| 3 | `resolveDns(target)` | The raw-IP literal path — currently rejected by the OS (`Address family for hostname not supported`) |
| 4 | `resolveDns(server DNS name)` | The workaround path — does the DuckDNS name resolve, and to what? |
| 5 | `resolveDns("example.com")` | Resolver + internet sanity, independent of your LAN |
| 6 | UDP socket + raw DNS query to the console's DNS server | **Opt-in (`udp=1`)** — is the socket layer up at all? EAGAIN here = reboot needed. Off by default: hard-crashed under Ryujinx's bsd emulation |
| 7 | `TCP connect dns-name:port` (5 s) | **The ping** — reached? refused (host answered!)? unreachable? timeout? |
| 8 | `TCP connect raw-ip:port` (5 s) | Same via the raw literal — the contrast to [3]/[7] |
| 9 | `HTTP GET http://dns-name:port/` (8 s) | Full stack round-trip by name |
| 10 | `POST /api/client-tokens/exchange` | RomMmate's exact login request by name — *any* HTTP reply (even 4xx) means the path works |
| 11 | `HTTPS GET example.com` | WAN reachability (informational only) |

True ICMP ping is not exposed to nx.js apps, so stage 7 is the ping: a TCP
connect to the RomM port. "Connection refused" is a *good* answer — the host
is up and answered, just not listening on that port. Stage 6 crafts a real
DNS query packet over a UDP socket, so it tests sockets + bidirectional
traffic without touching the TCP path.

Every line printed on screen is also appended to **`sdmc:/switch/romm-test.log`**
(one timestamped line at a time, so a crash still leaves evidence).

## Config

Optional, `sdmc:/switch/romm-test.txt`, one `key=value` per line (`#` starts a
comment):

```
host=10.147.18.46
port=8200
# The server's DNS name; stages 4/7/9/10 use it (raw IPs are currently
# rejected by the Switch's resolver, so this is the path that should work):
name=harinaldibologna.duckdns.org
# Optional: printed as context (verbatim user input, scheme case and all):
url=HTTP://10.147.18.46:8200
# Opt-in: enable the raw UDP socket probe (stage 6). Real hardware only —
# it hard-crashes under Ryujinx's incomplete bsd socket emulation:
# udp=1
```

Defaults are `host=10.147.18.46`, `port=8200`,
`name=harinaldibologna.duckdns.org`, `udp` off.

## Build

No compile step — the app is plain JS, so editing and repacking takes seconds:

```sh
# from the repo root, or from this directory:
npm run nro:nettest          # → tools/nettest/romm-nettest.nro
```

Copy `romm-nettest.nro` to `sdmc:/switch/` and launch it from the homebrew
menu. It runs the full sequence on launch; afterwards **press any button to
re-run** (e.g. after toggling Wi-Fi), **+ to exit**. Touch-drag scrolls the
output history.

## Reading results

The run ends with `stages ok: N/11` and `hint:` lines. The hints name the
failing layer directly, e.g.:

- `no IP config — connect Wi-Fi…` → console offline (stage 1 threw).
- `raw IP literals are rejected by the Switch resolver…` → stage 3 failure —
  the same error RomMmate's log shows. Fix for the app: put the **DNS name**
  (e.g. the DuckDNS one) in RomMmate's Base URL instead of a raw IP.
- `server reachable by DNS name…` → stages 4+7 pass: the name-based path
  works end to end, so `http://<name>:<port>` as Base URL should log in.
- `name resolves but the connection failed…` → DNS is fine, TCP to the
  server is not: server down, wrong port, or its network not routable from
  the Switch.
- `UDP probe failed too — … reboot the console` → sockets are refused even
  for UDP (`No more processes`/EAGAIN): the console's socket layer is down
  — reboot, then re-run before trusting any other verdict. Only appears when
  the probe is enabled with `udp=1`; it is skipped otherwise (and must stay
  skipped under Ryujinx, where it hard-crashes the process).
- `different subnet — server must be reachable by routing…` → the console and
  the server are on different networks; same-Wi-Fi is not enough.
- stage 7 `timed out` / `unreachable` → address resolves but packets don't
  arrive (routing/firewall); stage 7 `refused` → host is up, wrong port or
  RomM not running.
- `socket resources exhausted (EAGAIN)…` → transient runtime state; close
  other homebrew and re-run. If it persists across re-runs and stages,
  reboot the console.
