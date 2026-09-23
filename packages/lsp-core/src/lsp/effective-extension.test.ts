import { describe, expect, test } from "bun:test";

import { effectiveExtension } from "./effective-extension.js";

describe("effectiveExtension", () => {
	test("#given uppercase source extension #when resolving #then normalizes to lowercase", () => {
		// given / when / then
		expect(effectiveExtension("/project/src/APP.TS")).toBe(".ts");
		expect(effectiveExtension("/project/src/View.TSX")).toBe(".tsx");
	});

	test("#given Dockerfile basenames #when resolving #then keeps basename mappings", () => {
		// given / when / then
		expect(effectiveExtension("/project/Dockerfile")).toBe(".dockerfile");
		expect(effectiveExtension("/project/Containerfile")).toBe(".dockerfile");
	});
});
