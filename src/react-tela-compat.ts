/**
 * Workarounds for react-tela renderer bugs.
 *
 * `Root.insertBefore` — which the React reconciler uses whenever it places
 * a child that has a preceding sibling, i.e. essentially every reorder —
 * removes the child from its old slot first (firing the `'remove'` event,
 * which the renderer uses to abort its in-flight artwork load) but then
 * re-inserts it without firing any `'add'` event. An `<Image>` that moved
 * while its artwork was still decoding therefore never restarts the load:
 * its `src` prop is unchanged, the constructor already ran, and nothing
 * else re-kicks it. The tile sits on its dark placeholder plate forever.
 *
 * `Root.add` does fire `'add'`, so mirror it here: after an
 * `insertBefore` completes, tell the child it is back in the tree.
 * `CoverImage` listens for exactly this event to restart a killed load.
 *
 * Patched once, on the shared prototype — safe to call for every root
 * (the app renders one, the preview harness renders several).
 */
export function patchInsertBefore(root: object): void {
	const proto = Object.getPrototypeOf(root) as {
		__rommatePatched?: boolean;
		insertBefore?: (child: { dispatchEvent?: (e: Event) => boolean }, beforeChild: object) => unknown;
	} | null;
	if (proto === null || proto.__rommatePatched || typeof proto.insertBefore !== 'function') return;
	proto.__rommatePatched = true;
	const original = proto.insertBefore;
	proto.insertBefore = function (
		this: unknown,
		child: { dispatchEvent?: (e: Event) => boolean },
		beforeChild: object,
	): unknown {
		const result = original.call(this, child, beforeChild);
		try {
			child.dispatchEvent?.(new Event('add'));
		} catch {
			/* the event is a courtesy — never take a commit down over it */
		}
		return result;
	};
}
