import { describe, expect, it } from "vitest";
import { DESKTOP_METHODS, DISPLAY_METHODS, ELEMENT_METHODS, WINDOW_METHODS } from "../src/index";

/** Every helper a model-facing computer call chain may name; a new one is a deliberate edit here. */
const CHAIN_METHOD_SNAPSHOT = [
	"actions",
	"attributes",
	"ax",
	"bounds",
	"capabilities",
	"children",
	"click",
	"clipboard.read",
	"clipboard.write",
	"control.acquire",
	"control.release",
	"control.state",
	"display",
	"displays",
	"doubleClick",
	"drag",
	"elementAt",
	"find",
	"focus",
	"focusedElement",
	"focusedWindow",
	"holdKeys",
	"holdMouse",
	"menu.items",
	"menu.select",
	"move",
	"observe",
	"parent",
	"perform",
	"press",
	"raise",
	"ref",
	"screenshot",
	"scroll",
	"setValue",
	"type",
	"value",
	"window",
	"windows",
	"zoom",
];

/**
 * Engine controls only the host process may reach: stop-path lifecycle, resume, session ownership, and
 * the foreground grant itself. A call chain reaches the grant only through `control.acquire`, behind the
 * human confirm; run code has no handle-level path to it either (#9967). The grant is a consent guard for
 * a cooperating model, not a sandbox boundary: the run vm is not one.
 */
const HOST_CONTROL = /resume|stop|start|heartbeat|session\.open|control\.(grant|revoke)/i;

function chainMethods(): string[] {
	const names = new Set([
		...Object.keys(DESKTOP_METHODS),
		...Object.keys(DISPLAY_METHODS),
		...Object.keys(WINDOW_METHODS),
		...Object.keys(ELEMENT_METHODS),
	]);
	return [...names].sort();
}

describe("computer call-chain method allowlist", () => {
	it("equals the snapshot when every table is unioned", () => {
		expect(chainMethods()).toEqual(CHAIN_METHOD_SNAPSHOT);
	});

	it("exposes no stop-path, resume, or session control to a chain", () => {
		expect(chainMethods().filter((name) => HOST_CONTROL.test(name))).toEqual([]);
	});
});
