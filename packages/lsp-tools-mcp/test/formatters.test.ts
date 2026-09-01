import { describe, expect, it } from "vitest";

import { filterDiagnosticsBySeverity } from "../src/lsp/formatters.js";
import type { Diagnostic } from "../src/lsp/types.js";

const range = {
	start: { line: 0, character: 0 },
	end: { line: 0, character: 1 },
};

function diagnostic(message: string, severity?: number): Diagnostic {
	return severity === undefined ? { range, message } : { range, message, severity };
}

describe("filterDiagnosticsBySeverity", () => {
	it("#given all severity filter #when filtering diagnostics #then returns the original diagnostics", () => {
		// given
		const diagnostics = [diagnostic("syntax", 1), diagnostic("note", 3)];

		// when
		const filtered = filterDiagnosticsBySeverity(diagnostics, "all");

		// then
		expect(filtered).toBe(diagnostics);
	});

	it("#given mixed severities #when filtering diagnostics #then returns only matching diagnostics", () => {
		// given
		const diagnostics = [
			diagnostic("syntax", 1),
			diagnostic("lint", 2),
			diagnostic("note", 3),
			diagnostic("hint", 4),
			diagnostic("unknown"),
		];

		// when / then
		expect(filterDiagnosticsBySeverity(diagnostics, "error")).toEqual([diagnostics[0]]);
		expect(filterDiagnosticsBySeverity(diagnostics, "warning")).toEqual([diagnostics[1]]);
		expect(filterDiagnosticsBySeverity(diagnostics, "information")).toEqual([diagnostics[2]]);
		expect(filterDiagnosticsBySeverity(diagnostics, "hint")).toEqual([diagnostics[3]]);
	});
});
