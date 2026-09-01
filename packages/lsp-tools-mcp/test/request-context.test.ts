import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { getMergedServers } from "../src/lsp/config-loader.js";
import {
	contextCwd,
	contextEnv,
	createStandaloneMcpRequestContext,
	LspRequestContextUnavailableError,
	runWithRequestContext,
} from "../src/request-context.js";

const tempDirectories: string[] = [];

afterEach(() => {
	for (const directory of tempDirectories.splice(0)) {
		rmSync(directory, { recursive: true, force: true });
	}
});

describe("request context", () => {
	it("#given no active context #when contextCwd #then throws an actionable context error", () => {
		expect(() => contextCwd()).toThrow(LspRequestContextUnavailableError);
	});

	it("#given active context #when contextCwd #then returns context cwd", () => {
		const root = mkdtempSync(join(tmpdir(), "lsp-ctx-cwd-"));
		tempDirectories.push(root);
		const result = runWithRequestContext(createStandaloneMcpRequestContext({ cwd: root }), () => contextCwd());
		expect(result).toBe(realpathSync(root));
	});

	it("#given context env map #when key missing #then resolves undefined without process fallback", () => {
		process.env["LSP_CTX_TEST_KEY"] = "from-process";
		try {
			const root = mkdtempSync(join(tmpdir(), "lsp-ctx-env-"));
			tempDirectories.push(root);
			const result = runWithRequestContext(createStandaloneMcpRequestContext({ cwd: root, env: {} }), () =>
				contextEnv("LSP_CTX_TEST_KEY"),
			);
			expect(result).toBeUndefined();
		} finally {
			delete process.env["LSP_CTX_TEST_KEY"];
		}
	});

	it("#given no context #when contextEnv reads an arbitrary key #then throws before process env fallback", () => {
		process.env["LSP_CTX_TEST_KEY"] = "from-process";
		try {
			expect(() => contextEnv("LSP_CTX_TEST_KEY")).toThrow(LspRequestContextUnavailableError);
		} finally {
			delete process.env["LSP_CTX_TEST_KEY"];
		}
	});

	it("#given project config only reachable via context cwd #when getMergedServers #then honors context", () => {
		const root = mkdtempSync(join(tmpdir(), "lsp-ctx-project-"));
		tempDirectories.push(root);
		mkdirSync(join(root, ".codex"), { recursive: true });
		writeFileSync(
			join(root, ".codex", "lsp-client.json"),
			JSON.stringify({ lsp: { typescript: { extensions: [".mts"], priority: 7 } } }),
		);

		const withContext = runWithRequestContext(createStandaloneMcpRequestContext({ cwd: root }), () =>
			getMergedServers().find((server) => server.id === "typescript"),
		);

		expect(() => getMergedServers()).toThrow(LspRequestContextUnavailableError);
		expect(withContext?.source).toBe("project");
		expect(withContext?.extensions).toContain(".mts");
	});
});
