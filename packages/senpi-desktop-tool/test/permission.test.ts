import { describe, expect, it } from "vitest";
import { computerPermissionParser } from "../src/permission";

const windowStep = { method: "window", args: [{ app: "Code" }] };

function patternsOf(input: Record<string, unknown>): readonly string[] {
	return computerPermissionParser("computer", input, "/work").flatMap((request) => request.patterns);
}


describe("computerPermissionParser tiers", () => {
	it("classifies window->screenshot as read", () => {
		// Given
		const input = { action: "call", chain: [windowStep, { method: "screenshot" }] };

		// When
		const patterns = patternsOf(input);

		// Then
		expect(patterns).toEqual(["read"]);
	});

	it("classifies window->click as exec", () => {
		// Given
		const input = { action: "call", chain: [windowStep, { method: "click", args: [1, 2] }] };

		// When
		const patterns = patternsOf(input);

		// Then
		expect(patterns).toEqual(["exec"]);
	});

	it("classifies run without read_only as exec", () => {
		// Given
		const input = { action: "run", code: "return 1" };

		// When
		const patterns = patternsOf(input);

		// Then
		expect(patterns).toEqual(["exec"]);
	});

	it("classifies run with read_only true as read", () => {
		// Given
		const input = { action: "run", code: "return 1", read_only: true };

		// When
		const patterns = patternsOf(input);

		// Then
		expect(patterns).toEqual(["read"]);
	});

	it("classifies capabilities as read", () => {
		// Given
		const input = { action: "capabilities" };

		// When
		const patterns = patternsOf(input);

		// Then
		expect(patterns).toEqual(["read"]);
	});

	it.each([
		["an unknown root method", [{ method: "userReset" }]],
		["an unknown handle method", [windowStep, { method: "userReset" }]],
		["a three-step chain of reads", [windowStep, { method: "ref", args: ["e1"] }, { method: "value" }]],
		["an unchainable root", [{ method: "windows" }, { method: "screenshot" }]],
		["a non-object step", [null]],
		["a missing chain", undefined],
	])("never classifies %s as read", (_label, chain) => {
		// Given
		const input = { action: "call", chain };

		// When
		const patterns = patternsOf(input);

		// Then
		expect(patterns).toEqual(["exec"]);
	});

	it("names the computer permission and scopes an always-approval to the requested tier", () => {
		// Given
		const input = { action: "call", chain: [{ method: "screenshot" }] };

		// When
		const requests = computerPermissionParser("computer", input, "/work");

		// Then
		expect(requests).toEqual([{ permission: "computer", patterns: ["read"], always: ["read"] }]);
	});
});

