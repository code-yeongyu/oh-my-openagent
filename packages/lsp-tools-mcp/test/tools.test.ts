import { describe, expect, it } from "vitest";

import { executeLspTool } from "../src/tools.js";

const missingServerMessagePrefix = "No LSP server configured for extension: .wat";
const unconfiguredPath = "module.wat";

describe("executeLspTool", () => {
	it("#given missing language server #when diagnostics runs #then returns the existing diagnostics error details", async () => {
		// given / when
		const result = await executeLspTool("diagnostics", { filePath: unconfiguredPath });

		// then
		expect(result.content[0]?.text).toContain(missingServerMessagePrefix);
		expect(result.details).toMatchObject({
			filePath: unconfiguredPath,
			severity: "all",
			mode: "file",
			diagnostics: [],
			totalDiagnostics: 0,
			truncated: false,
			errorKind: "missing_dependency",
		});
		expect(result.details).toHaveProperty("error", result.content[0]?.text);
	});

	it("#given missing language server #when goto definition runs #then returns the existing definition error details", async () => {
		// given / when
		const result = await executeLspTool("goto_definition", { filePath: unconfiguredPath, line: 1, character: 2 });

		// then
		expect(result.content[0]?.text).toContain(missingServerMessagePrefix);
		expect(result.details).toMatchObject({
			filePath: unconfiguredPath,
			line: 1,
			character: 2,
			locations: [],
			errorKind: "missing_dependency",
		});
		expect(result.details).toHaveProperty("error", result.content[0]?.text);
	});

	it("#given missing language server #when find references runs #then returns the existing references error details", async () => {
		// given / when
		const result = await executeLspTool("find_references", { filePath: unconfiguredPath, line: 1, character: 2 });

		// then
		expect(result.content[0]?.text).toContain(missingServerMessagePrefix);
		expect(result.details).toMatchObject({
			filePath: unconfiguredPath,
			line: 1,
			character: 2,
			references: [],
			totalReferences: 0,
			truncated: false,
			errorKind: "missing_dependency",
		});
		expect(result.details).toHaveProperty("error", result.content[0]?.text);
	});

	it("#given missing language server #when symbols runs #then returns the existing symbols error details", async () => {
		// given / when
		const result = await executeLspTool("symbols", { filePath: unconfiguredPath, scope: "workspace", query: "Todo" });

		// then
		expect(result.content[0]?.text).toContain(missingServerMessagePrefix);
		expect(result.details).toMatchObject({
			filePath: unconfiguredPath,
			scope: "workspace",
			query: "Todo",
			symbols: [],
			totalSymbols: 0,
			truncated: false,
			errorKind: "missing_dependency",
		});
		expect(result.details).toHaveProperty("error", result.content[0]?.text);
	});

	it("#given missing language server #when prepare rename runs #then returns the existing prepare rename error details", async () => {
		// given / when
		const result = await executeLspTool("prepare_rename", { filePath: unconfiguredPath, line: 1, character: 2 });

		// then
		expect(result.content[0]?.text).toContain(missingServerMessagePrefix);
		expect(result.details).toMatchObject({
			filePath: unconfiguredPath,
			line: 1,
			character: 2,
			result: null,
			errorKind: "missing_dependency",
		});
		expect(result.details).toHaveProperty("error", result.content[0]?.text);
	});

	it("#given missing language server #when rename runs #then returns the existing rename error details", async () => {
		// given / when
		const result = await executeLspTool("rename", {
			filePath: unconfiguredPath,
			line: 1,
			character: 2,
			newName: "renamed",
		});

		// then
		expect(result.content[0]?.text).toContain(missingServerMessagePrefix);
		expect(result.details).toMatchObject({
			filePath: unconfiguredPath,
			line: 1,
			character: 2,
			newName: "renamed",
			apply: null,
			edit: null,
			errorKind: "missing_dependency",
		});
		expect(result.details).toHaveProperty("error", result.content[0]?.text);
	});
});
