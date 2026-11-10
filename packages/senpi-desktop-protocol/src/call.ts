/** One allowlisted method invocation in a direct computer call chain. */
export interface ComputerCallStep {
	readonly method: string;
	readonly args?: readonly unknown[];
}

/** Approval tier a direct computer helper needs: inspection reads, input and mutation execute. */
export type ComputerCallPolicy = "read" | "exec";

type MethodPolicies = Readonly<Record<string, ComputerCallPolicy>>;

// <generated:facade> from facade-manifest.json by scripts/generate-assets.ts; edit CHAIN_BINDINGS there, then `bun run generate`
/** Helpers callable on the `desktop` root; `window` and `ref` also anchor one-hop handle chains. */
export const DESKTOP_METHODS: MethodPolicies = {
	capabilities: "read", // Computer.capabilities
	displays: "read", // Computer.displays
	display: "read", // kernel-only: no SDK facade method yet
	windows: "read", // Computer.windows
	window: "read", // Computer.window
	focusedWindow: "read", // kernel-only: no SDK facade method yet
	screenshot: "read", // Target.screenshot
	zoom: "read", // Frame.zoom
	click: "exec", // Pointer.click
	doubleClick: "exec", // Pointer.click
	move: "exec", // Pointer.move
	drag: "exec", // Pointer.drag
	scroll: "exec", // Pointer.scroll
	type: "exec", // Keyboard.type
	press: "exec", // Keyboard.chord
	holdKeys: "exec", // Keyboard.hold
	holdMouse: "exec", // Pointer.hold
	elementAt: "read", // kernel-only: no SDK facade method yet
	focusedElement: "read", // kernel-only: no SDK facade method yet
	ref: "read", // Window.element
	"clipboard.read": "read", // kernel-only: no SDK facade method yet
	"clipboard.write": "exec", // kernel-only: no SDK facade method yet
	"control.acquire": "exec", // Control.acquire
	"control.release": "exec", // Control.release
	"control.state": "read", // Control.state
};

/** Helpers callable on a display handle resolved through `desktop.display(selector)`. */
export const DISPLAY_METHODS: MethodPolicies = {
	screenshot: "read", // Target.screenshot
	zoom: "read", // Frame.zoom
	click: "exec", // Pointer.click
	doubleClick: "exec", // Pointer.click
	move: "exec", // Pointer.move
	drag: "exec", // Pointer.drag
	scroll: "exec", // Pointer.scroll
	type: "exec", // Keyboard.type
	press: "exec", // Keyboard.chord
	holdKeys: "exec", // Keyboard.hold
	holdMouse: "exec", // Pointer.hold
};

/** Helpers callable on a window handle resolved through `desktop.window(id)`. */
export const WINDOW_METHODS: MethodPolicies = {
	screenshot: "read", // Target.screenshot
	observe: "read", // Target.observe
	zoom: "read", // Frame.zoom
	click: "exec", // Pointer.click
	doubleClick: "exec", // Pointer.click
	move: "exec", // Pointer.move
	drag: "exec", // Pointer.drag
	scroll: "exec", // Pointer.scroll
	type: "exec", // Keyboard.type
	press: "exec", // Keyboard.chord
	holdKeys: "exec", // Keyboard.hold
	holdMouse: "exec", // Pointer.hold
	raise: "exec", // Window.raise
	ax: "read", // Target.ax
	find: "read", // Window.find
	ref: "read", // Window.element
	"menu.items": "read", // Menus.items
	"menu.select": "exec", // Menus.select
};

/** Helpers callable on an AX element handle resolved through `desktop.ref(ref)`. */
export const ELEMENT_METHODS: MethodPolicies = {
	value: "read", // Element.read
	setValue: "exec", // Element.setValue
	bounds: "read", // Element.read
	attributes: "read", // Element.attributes
	actions: "read", // Element.read
	perform: "exec", // Element.perform
	press: "exec", // Element.press
	click: "exec", // Element.click
	type: "exec", // Element.type
	focus: "exec", // Element.focus
	parent: "read", // Element.read
	children: "read", // Element.read
};
// </generated:facade>

/** Root methods whose result accepts one chained handle call, mapped to the handle's method table. */
const HANDLE_ROOTS: Readonly<Record<string, { readonly label: string; readonly methods: MethodPolicies }>> = {
	display: { label: "display", methods: DISPLAY_METHODS },
	window: { label: "window", methods: WINDOW_METHODS },
	ref: { label: "element", methods: ELEMENT_METHODS },
};

/** Why a call chain was refused before classification. */
export type ComputerCallErrorReason = "empty" | "tooLong" | "unknownMethod" | "notChainable";

/** A call chain that is not an allowlisted one-hop desktop call. */
export class ComputerCallError extends Error {
	readonly reason: ComputerCallErrorReason;

	constructor(reason: ComputerCallErrorReason, message: string) {
		super(message);
		this.name = "ComputerCallError";
		this.reason = reason;
	}
}

function policyOf(methods: MethodPolicies, method: string): ComputerCallPolicy | undefined {
	return Object.hasOwn(methods, method) ? methods[method] : undefined;
}

function describe(methods: MethodPolicies): string {
	return Object.keys(methods).join(", ");
}

function classifyComputerCall(chain: readonly ComputerCallStep[]): ComputerCallPolicy {
	const [root, step, ...rest] = chain;
	if (root === undefined) {
		throw new ComputerCallError("empty", "Action 'call' requires a non-empty 'chain'.");
	}
	if (rest.length > 0) {
		throw new ComputerCallError(
			"tooLong",
			"Call chains support one handle hop at most; use computer.run(fn) for longer sequences.",
		);
	}
	const rootPolicy = policyOf(DESKTOP_METHODS, root.method);
	if (rootPolicy === undefined) {
		throw new ComputerCallError(
			"unknownMethod",
			`Unknown desktop method "${root.method}". Desktop helpers support: ${describe(DESKTOP_METHODS)}.`,
		);
	}
	if (step === undefined) {
		return rootPolicy;
	}
	const handle = Object.hasOwn(HANDLE_ROOTS, root.method) ? HANDLE_ROOTS[root.method] : undefined;
	if (handle === undefined) {
		throw new ComputerCallError(
			"notChainable",
			`Only desktop.display(id)/desktop.window(id)/desktop.ref(ref) results accept a chained call; got desktop.${root.method}().`,
		);
	}
	const stepPolicy = policyOf(handle.methods, step.method);
	if (stepPolicy === undefined) {
		throw new ComputerCallError(
			"unknownMethod",
			`Unknown ${handle.label} method "${step.method}". Supported ${handle.label} methods: ${describe(handle.methods)}.`,
		);
	}
	return stepPolicy;
}

/**
 * Whether every step of a direct computer call is inspection-only, so the call needs read approval.
 * Throws `ComputerCallError` for an empty, over-long, unknown, or unchainable chain.
 */
export function isReadOnlyComputerCall(chain: readonly ComputerCallStep[]): boolean {
	return classifyComputerCall(chain) === "read";
}
