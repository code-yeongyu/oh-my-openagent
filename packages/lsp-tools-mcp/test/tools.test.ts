import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { loadInstallDecision } from "../src/lsp/server-install-state.js";
import {
	createStandaloneMcpRequestContext,
	runWithRequestContext,
	type LspRequestContext,
} from "../src/request-context.js";
import { executeLspTool } from "../src/tools.js";

const missingServerMessagePrefix = "No LSP server configured for extension: .wat";
const unconfiguredPath = "module.wat";

function withStandaloneContext<T>(fn: () => T): T {
	return runWithRequestContext(createStandaloneMcpRequestContext(), fn);
}

describe("executeLspTool", () => {
	it("#given missing language server #when diagnostics runs #then returns the existing diagnostics error details", async () => {
		// given / when
		const result = await withStandaloneContext(() => executeLspTool("diagnostics", { filePath: unconfiguredPath }));

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
		const result = await withStandaloneContext(() =>
			executeLspTool("goto_definition", { filePath: unconfiguredPath, line: 1, character: 2 }),
		);

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
		const result = await withStandaloneContext(() =>
			executeLspTool("find_references", { filePath: unconfiguredPath, line: 1, character: 2 }),
		);

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
		const result = await withStandaloneContext(() =>
			executeLspTool("symbols", { filePath: unconfiguredPath, scope: "workspace", query: "Todo" }),
		);

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
		const result = await withStandaloneContext(() =>
			executeLspTool("prepare_rename", { filePath: unconfiguredPath, line: 1, character: 2 }),
		);

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
		const result = await withStandaloneContext(() =>
			executeLspTool("rename", {
				filePath: unconfiguredPath,
				line: 1,
				character: 2,
				newName: "renamed",
			}),
		);

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

describe("executeLspTool install_decision", () => {
	const tempDirectories: string[] = [];
	const saved = new Map<string, string | undefined>();
	let requestContext: LspRequestContext;

	function setEnv(name: string, value: string): void {
		if (!saved.has(name)) saved.set(name, process.env[name]);
		process.env[name] = value;
	}

	beforeEach(() => {
		const dir = mkdtempSync(join(tmpdir(), "lsp-tool-decisions-"));
		tempDirectories.push(dir);
		setEnv("LSP_TOOLS_MCP_INSTALL_DECISIONS", join(dir, "lsp-install-decisions.json"));
		setEnv("LSP_TOOLS_MCP_USER_CONFIG", join(dir, "absent-user.json"));
		setEnv("LSP_TOOLS_MCP_PROJECT_CONFIG", "absent-project.json");
		requestContext = createStandaloneMcpRequestContext({ cwd: dir });
	});

	afterEach(() => {
		for (const [name, value] of saved) {
			if (value === undefined) {
				delete process.env[name];
			} else {
				process.env[name] = value;
			}
		}
		saved.clear();
		for (const directory of tempDirectories.splice(0)) {
			rmSync(directory, { recursive: true, force: true });
		}
	});

	it("#given a known server #when recording a decline #then persists it and confirms", async () => {
		// when
		const result = await runWithRequestContext(requestContext, () =>
			executeLspTool("install_decision", { server_id: "typescript", decision: "declined" }),
		);

		// then
		expect(result.isError ?? false).toBe(false);
		expect(result.content[0]?.text).toContain("typescript");
		expect(result.content[0]?.text.toLowerCase()).toContain("declined");
		expect(runWithRequestContext(requestContext, () => loadInstallDecision("typescript"))).toMatchObject({
			decision: "declined",
		});
	});

	it("#given an allowed decision #when recording it #then persists allowed", async () => {
		// when
		await runWithRequestContext(requestContext, () =>
			executeLspTool("install_decision", { server_id: "typescript", decision: "allowed" }),
		);

		// then
		expect(runWithRequestContext(requestContext, () => loadInstallDecision("typescript"))).toMatchObject({
			decision: "allowed",
		});
	});

	it("#given an unknown server id #when recording a decision #then returns a helpful error", async () => {
		// when
		const result = await runWithRequestContext(requestContext, () =>
			executeLspTool("install_decision", { server_id: "no-such-server", decision: "declined" }),
		);

		// then
		expect(result.isError).toBe(true);
		expect(result.content[0]?.text).toContain("no-such-server");
		expect(runWithRequestContext(requestContext, () => loadInstallDecision("no-such-server"))).toBeUndefined();
	});

	it("#given an invalid decision value #when recording it #then returns a helpful error", async () => {
		// when
		const result = await runWithRequestContext(requestContext, () =>
			executeLspTool("install_decision", { server_id: "typescript", decision: "maybe" }),
		);

		// then
		expect(result.isError).toBe(true);
		expect(result.content[0]?.text.toLowerCase()).toContain("decision");
		expect(runWithRequestContext(requestContext, () => loadInstallDecision("typescript"))).toBeUndefined();
	});
});
