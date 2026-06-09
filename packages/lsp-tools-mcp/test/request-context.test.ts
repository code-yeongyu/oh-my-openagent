import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { getMergedServers } from "../src/lsp/config-loader.js";
import { contextCwd, contextEnv, runWithRequestContext } from "../src/request-context.js";

const tempDirectories: string[] = [];

afterEach(() => {
	for (const directory of tempDirectories.splice(0)) {
		rmSync(directory, { recursive: true, force: true });
	}
});

describe("request context", () => {
	it("#given no active context #when contextCwd #then returns process cwd", () => {
		expect(contextCwd()).toBe(process.cwd());
	});

	it("#given active context #when contextCwd #then returns context cwd", () => {
		const result = runWithRequestContext({ cwd: "/tmp/session-root" }, () => contextCwd());
		expect(result).toBe("/tmp/session-root");
	});

	it("#given context env map #when key missing #then resolves undefined without process fallback", () => {
		process.env["LSP_CTX_TEST_KEY"] = "from-process";
		try {
			const result = runWithRequestContext({ env: {} }, () => contextEnv("LSP_CTX_TEST_KEY"));
			expect(result).toBeUndefined();
		} finally {
			delete process.env["LSP_CTX_TEST_KEY"];
		}
	});

	it("#given no context #when contextEnv #then falls back to process env", () => {
		process.env["LSP_CTX_TEST_KEY"] = "from-process";
		try {
			expect(contextEnv("LSP_CTX_TEST_KEY")).toBe("from-process");
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

		const withoutContext = getMergedServers().find((server) => server.id === "typescript");
		const withContext = runWithRequestContext({ cwd: root }, () =>
			getMergedServers().find((server) => server.id === "typescript"),
		);

		expect(withContext?.source).toBe("project");
		expect(withContext?.extensions).toContain(".mts");
		expect(withoutContext?.source).not.toBe("project");
	});
});
