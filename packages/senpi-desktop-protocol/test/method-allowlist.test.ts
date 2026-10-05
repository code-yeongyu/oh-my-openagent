import { describe, expect, it } from "vitest";
import { DESKTOP_METHODS, ELEMENT_METHODS, WINDOW_METHODS } from "../src/index";

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
	"displays",
	"doubleClick",
	"drag",
	"elementAt",
	"find",
	"focus",
	"focusedElement",
	"focusedWindow",
	"move",
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
];

/** Engine controls only the host process may reach: stop-path lifecycle, resume, and session ownership. */
const HOST_CONTROL = /resume|stop|start|heartbeat|session\.open/i;

function chainMethods(): string[] {
	const names = new Set([
		...Object.keys(DESKTOP_METHODS),
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
