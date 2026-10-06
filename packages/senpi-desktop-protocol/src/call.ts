/** One allowlisted method invocation in a direct computer call chain. */
export interface ComputerCallStep {
	readonly method: string;
	readonly args?: readonly unknown[];
}

/** Approval tier a direct computer helper needs: inspection reads, input and mutation execute. */
export type ComputerCallPolicy = "read" | "exec";

type MethodPolicies = Readonly<Record<string, ComputerCallPolicy>>;

/** Helpers callable on the `desktop` root; `window` and `ref` also anchor one-hop handle chains. */
export const DESKTOP_METHODS: MethodPolicies = {
	capabilities: "read",
	displays: "read",
	windows: "read",
	window: "read",
	focusedWindow: "read",
	screenshot: "read",
	click: "exec",
	doubleClick: "exec",
	move: "exec",
	drag: "exec",
	scroll: "exec",
	type: "exec",
	press: "exec",
	elementAt: "read",
	focusedElement: "read",
	ref: "read",
	"clipboard.read": "read",
	"clipboard.write": "exec",
};

/** Helpers callable on a window handle resolved through `desktop.window(id)`. */
export const WINDOW_METHODS: MethodPolicies = {
	screenshot: "read",
	click: "exec",
	doubleClick: "exec",
	move: "exec",
	drag: "exec",
	scroll: "exec",
	type: "exec",
	press: "exec",
	raise: "exec",
	ax: "read",
	find: "read",
	ref: "read",
};

/** Helpers callable on an AX element handle resolved through `desktop.ref(ref)`. */
export const ELEMENT_METHODS: MethodPolicies = {
	value: "read",
	setValue: "exec",
	bounds: "read",
	attributes: "read",
	actions: "read",
	perform: "exec",
	press: "exec",
	click: "exec",
	focus: "exec",
	parent: "read",
	children: "read",
};

/** Root methods whose result accepts one chained handle call, mapped to the handle's method table. */
const HANDLE_ROOTS: Readonly<Record<string, { readonly label: string; readonly methods: MethodPolicies }>> = {
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
			`Only desktop.window(id)/desktop.ref(ref) results accept a chained call; got desktop.${root.method}().`,
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
