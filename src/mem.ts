/**
 * Memory snapshots for the on-device log.
 *
 * The runtime exposes every allocator's gauge through `Switch.memoryUsage()`
 * (V8 HeapStatistics + the native malloc arena). This is what separates the
 * suspects during an OOM hunt: the JS slabs (usedHeapSize / totalPhysical),
 * the off-heap backings V8 knows about (externalMemory), Skia's accounting
 * (malloced/peak), and the newlib arena as a whole (nativeHeap*).
 *
 * `Switch` only exists on-device; in the browser preview this is a no-op.
 */
import { log } from './log';
import { BUILD_ID } from './version';

interface MemoryUsage {
	totalHeapSize?: number;
	totalPhysicalSize?: number;
	totalAvailableSize?: number;
	usedHeapSize?: number;
	heapSizeLimit?: number;
	mallocedMemory?: number;
	peakMallocedMemory?: number;
	externalMemory?: number;
	nativeHeapTotal?: number;
	nativeHeapArena?: number;
	nativeHeapUsed?: number;
	nativeHeapFree?: number;
}

function usage(): MemoryUsage | null {
	const g = globalThis as unknown as {
		Switch?: { memoryUsage?: () => MemoryUsage };
	};
	return typeof g.Switch?.memoryUsage === 'function' ? g.Switch.memoryUsage() : null;
}

const MiB = (bytes: number | undefined): number =>
	bytes === undefined ? -1 : Math.round(bytes / 1048576);

/**
 * One compact log line with the gauges in MiB. Order matches the story:
 * live JS, retained physical, off-heap objects, Skia's mallocs, the native
 * arena, and the configured ceiling.
 */
export function memSnapshot(): string {
	const u = usage();
	if (u === null) return 'browser';
	return (
		`js=${MiB(u.usedHeapSize)} phys=${MiB(u.totalPhysicalSize)} ` +
		`ext=${MiB(u.externalMemory)} mall=${MiB(u.mallocedMemory)} ` +
		`peak=${MiB(u.peakMallocedMemory)} native=${MiB(u.nativeHeapUsed)} ` +
		`arena=${MiB(u.nativeHeapArena)} free=${MiB(u.nativeHeapFree)} ` +
		`limit=${MiB(u.heapSizeLimit)}`
	);
}

/** Logs the running build id once at boot, so every reported crash
 * names the exact binary that produced it. */
export function logBootId(): void {
	log('boot', `build ${BUILD_ID} — ${memSnapshot()}`);
}
