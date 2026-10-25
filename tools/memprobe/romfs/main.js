/**
 * RomM MemProbe — a standalone memory-attribution probe for RomMmate.
 *
 * THE INVESTIGATION
 * -----------------
 * The app dies with an OOM whose fault line is a *native* malloc failure
 * (the caught one paints the app's error screen; the uncaught one kills
 * the process from GC "young object promotion failed"), while the JS heap
 * itself stays small. The instrumented app build showed the native arena
 * growing ~20-30 MiB/s linearly, independent of the library walk.
 *
 * Static reading of the embedded runtime found a candidate mechanism: the
 * canvas `set font` allocates two FontFaces (each backed by a copy of the
 * shared system font) every time its linear font lookup MISSES — and a
 * `bold` font string can never match (the system face is normal-weight),
 * so every render that mixes bold text misses forever, growing one set
 * until the arena dies — while the growing linear scan slows every paint.
 *
 * The phases below test the subsystems in isolation:
 *
 *   baseline     no canvas work at all
 *   shapes       clear + rects/strokes per frame — no text
 *   text         ONE unchanged font string per frame (control: the
 *                runtime's own early-out should zero the work)
 *   text-sizes   30 DISTINCT sizes per frame, normal weight (control:
 *                distinct strings hit the cached face — no adds)
 *   text-measure set font + measureText churn, no paint (the app's own
 *                wrapping path re-measures every text per render)
 *   text-weights alternating bold/normal strings per frame (the attack:
 *                every bold string is a permanent miss → set grows)
 *   image        one Image drawn 40x per frame (steady state)
 *   image-new    a new Image per frame (cover churn + GC release path)
 *   fetch        a tiny HTTP round trip every ~250 ms (socket churn)
 *   done         idle sampler keeps running until the user exits
 *
 * Controls: + exits. Everything lands in `sdmc:/switch/memprobe.log`,
 * one timestamped line per event, including the FontFaceSet size.
 */

const LOG_PATH = 'sdmc:/switch/memprobe.log';
const PHASE_MS = 15000;
const TICK_MS = 25; // ~40 ticks per second; each tick paints one "frame"

/** @type {CanvasRenderingContext2D} */
const ctx = screen.getContext('2d');

const PHASES = [
	{
		name: 'baseline',
		tick() {
			/* nothing — pure idle baseline */
		},
	},
	{
		name: 'shapes',
		tick() {
			ctx.fillStyle = '#101418';
			ctx.fillRect(0, 0, 1280, 720);
			ctx.fillStyle = '#224466';
			for (let i = 0; i < 200; i++) {
				const w = 80 + ((i * 37) % 200);
				ctx.fillRect((i * 53) % 1200, (i * 29) % 680, w, 60);
			}
			ctx.strokeStyle = '#88aacc';
			ctx.strokeRect(100, 100, 1080, 520);
		},
	},
	{
		name: 'text',
		tick() {
			ctx.fillStyle = '#101418';
			ctx.fillRect(0, 0, 1280, 720);
			ctx.font = '20px system-ui'; // constant string: runtime early-outs
			ctx.fillStyle = '#e0e0e0';
			for (let i = 0; i < 30; i++) {
				ctx.fillText(`Title ${i} — The Legend of Zelda: Ocarina of Time`, 40, 60 + i * 22);
			}
		},
	},
	{
		name: 'text-sizes',
		tick() {
			// 30 distinct sizes, all normal-weight: distinct strings reach
			// findFont each frame but every lookup HITS the cached face.
			ctx.fillStyle = '#101418';
			ctx.fillRect(0, 0, 1280, 720);
			ctx.fillStyle = '#e0e0e0';
			for (let i = 0; i < 30; i++) {
				const size = 10 + (i % 24);
				ctx.font = `${size}px system-ui`;
				ctx.fillText(`Title ${i} — The Legend of Zelda`, 40, 40 + i * 22);
			}
		},
	},
	{
		name: 'text-measure',
		tick() {
			// The app's own wrapping path: per render it re-measures -every-
			// text (wrapLines/measure in text.ts), so set font + measureText
			// churn without ever painting glyphs. Normal weight, varied sizes.
			ctx.fillStyle = '#101418';
			ctx.fillRect(0, 0, 1280, 720);
			let width = 0;
			for (let i = 0; i < 30; i++) {
				const size = 10 + (i % 24);
				ctx.font = `${size}px system-ui`;
				width += ctx.measureText(`Title ${i} — The Legend of Zelda`).width;
			}
			ctx.fillText(`${width}`, 40, 60);
		},
	},
	{
		name: 'text-weights',
		tick() {
			// The attack: alternate weight per text. Each `bold` string is a
			// PERMANENT miss in the runtime's registry (its system face is
			// normal-weight), so every one of these bars re-adds two faces.
			// Keep it to 4 alternations per frame at 40 fps: enough for a
			// clean slope without dying inside the phase.
			ctx.fillStyle = '#101418';
			ctx.fillRect(0, 0, 1280, 720);
			ctx.fillStyle = '#e0e0e0';
			for (let i = 0; i < 4; i++) {
				const weight = tickCount % 2 === 0 ? 'bold' : 'normal';
				ctx.font = `${weight} 20px system-ui`;
				ctx.fillText(`Bold test ${i} — the font registry churns here`, 40, 40 + i * 30);
			}
		},
	},
	{
		name: 'image',
		made: false,
		tick() {
			if (!this.made) {
				this.made = true;
				this.img = new Image(216, 288);
			}
			ctx.fillStyle = '#101418';
			ctx.fillRect(0, 0, 1280, 720);
			for (let i = 0; i < 40; i++) {
				ctx.drawImage(this.img, 40 + (i % 10) * 130, 40 + Math.floor(i / 10) * 170);
			}
		},
	},
	{
		name: 'image-new',
		tick() {
			// Cover churn: a fresh Image every frame, drawn, then left for
			// the GC — probes the native release path on GC-coupled entities.
			ctx.fillStyle = '#101418';
			ctx.fillRect(0, 0, 1280, 720);
			const img = new Image(216, 288);
			for (let i = 0; i < 40; i++) {
				ctx.drawImage(img, 40 + (i % 10) * 130, 40 + Math.floor(i / 10) * 170);
			}
		},
	},
	{
		name: 'fetch',
		n: 0,
		tick() {
			this.n += 1;
			if (this.n % 10 === 0) {
				// One round trip per ~250 ms — the walk's rhythm.
				fetch('http://example.com/', { method: 'GET' })
					.then((res) => res.arrayBuffer())
					.catch(() => {});
			}
			ctx.fillStyle = '#101418';
			ctx.fillRect(0, 0, 1280, 720);
		},
	},
];

let tickCount = 0;
let phaseIdx = 0;
let phaseStart = Date.now();
let lastSnap = 0;
let done = false;

function memLine(tag) {
	try {
		const u = Switch.memoryUsage();
		const mib = (b) => Math.round(b / 1048576);
		let faces = -1;
		try {
			faces = document.fonts.size;
		} catch {
			/* document.fonts not exposed in this runtime; skip the gauge */
		}
		return (
			`${tag} js=${mib(u.usedHeapSize)} phys=${mib(u.totalPhysicalSize)} ` +
			`ext=${mib(u.externalMemory)} mall=${mib(u.mallocedMemory)} ` +
			`peak=${mib(u.peakMallocedMemory)} native=${mib(u.nativeHeapUsed)} ` +
			`arena=${mib(u.nativeHeapArena)} free=${mib(u.nativeHeapFree)} ` +
			`limit=${mib(u.heapSizeLimit)} faces=${faces}`
		);
	} catch (err) {
		return `${tag} memSnapshot unavailable: ${err && err.message}`;
	}
}

/**
 * Periodic snapshots go to the file only: a console.log during the canvas
 * phases could trigger render-mode work of its own, which would show up in
 * the very growth curve the probe is trying to attribute.
 */
function out(line, toConsole = false) {
	if (toConsole) console.log(line);
	try {
		Switch.appendFileSync(LOG_PATH, `${new Date().toISOString()} ${line}\n`);
	} catch {
		/* best-effort */
	}
}

out('=== RomM MemProbe ===', true);
out(memLine('boot'), true);

async function run() {
	for (let idx = 0; idx < PHASES.length; idx++) {
		phaseIdx = idx;
		const phase = PHASES[idx];
		phaseStart = Date.now();
		lastSnap = 0;
		out(memLine(`phase=${phase.name} start`), true);
		await new Promise((resolve) => setTimeout(resolve, PHASE_MS));
		out(memLine(`phase=${phase.name} end`), true);
	}
	done = true;
	out('done — all phases complete; idle sampler continues, press + to exit', true);
}

void run();

setInterval(() => {
	tickCount += 1;
	if (done) {
		if (Date.now() - lastSnap >= 30000) {
			lastSnap = Date.now();
			out(memLine('idle'));
		}
		return;
	}
	const phase = PHASES[phaseIdx];
	if (phase && phase.name !== 'baseline') {
		try {
			phase.tick();
		} catch (err) {
			// A throwing tick must not cancel the measurement loop; log it
			// once per phase and keep sampling from this phase's ctx ops.
			if (!phase.__err) {
				phase.__err = true;
				out(`error phase=${phase.name}: ${err && err.message}`);
			}
		}
	}
	if (Date.now() - lastSnap >= 5000) {
		lastSnap = Date.now();
		out(memLine(`phase=${phase ? phase.name : '?'} running`));
	}
}, TICK_MS);
