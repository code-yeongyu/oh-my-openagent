import { describe, expect, it } from "vitest";
import { DESKTOP_METHODS, ELEMENT_METHODS, WINDOW_METHODS } from "../../senpi-desktop-protocol/src/index";
import { computerPreludeAssets } from "../src/index";
import { javascriptHelperNames, pythonHelperNames } from "./helper-names";

/** Facade helpers that are tool actions of their own (`run`, `close`), not call-chain methods. */
const ACTION_HELPERS = new Set(["run", "close"]);
/** Engine controls only the host process may reach: stop-path lifecycle, resume, and session ownership. */
const HOST_CONTROL = /resume|stop|start|heartbeat|session\.open/i;

function chainMethods(names: readonly string[]): string[] {
	return [...new Set(names.filter((name) => !ACTION_HELPERS.has(name)))].sort();
}

const allowlist = [...computerPreludeAssets.methodAllowlist].sort();

describe("computer facade method allowlist", () => {
	it("equals the union of the protocol tier tables", () => {
		// Given
		const tables = [DESKTOP_METHODS, WINDOW_METHODS, ELEMENT_METHODS];

		// When
		const protocolUnion = [...new Set(tables.flatMap((table) => Object.keys(table)))].sort();

		// Then
		expect(allowlist).toEqual(protocolUnion);
	});

	it("matches the JavaScript facade's helper names", async () => {
		// When
		const names = await javascriptHelperNames();

		// Then
		expect(chainMethods(names)).toEqual(allowlist);
	});

	it("matches the Python facade's helper names", () => {
		// When
		const names = pythonHelperNames();

		// Then
		expect(chainMethods(names)).toEqual(allowlist);
	});

	it("contains no host-only control a model could reach", () => {
		// When
		const hostOnly = allowlist.filter((name) => HOST_CONTROL.test(name));

		// Then
		expect(hostOnly).toEqual([]);
	});
});
