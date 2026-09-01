import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "bun:test";

import { createStandaloneMcpRequestContext, runWithRequestContext } from "../request-context.js";
import { findWorkspaceRoot, resolveReadablePathInsideContext, resolvePathInsideContext } from "./client-wrapper.js";
import { LspInvalidPathError } from "./errors.js";

const tempDirectories: string[] = [];

afterEach(() => {
	for (const directory of tempDirectories.splice(0)) {
		rmSync(directory, { recursive: true, force: true });
	}
});

function tempRoot(prefix: string): string {
	const root = mkdtempSync(join(tmpdir(), prefix));
	tempDirectories.push(root);
	return root;
}

describe("LSP read-only access outside request cwd", () => {
	it("#given an absolute file outside cwd #when resolving a read path #then returns the canonical path", () => {
		const root = tempRoot("lsp-outcwd-root-");
		const outside = tempRoot("lsp-outcwd-outside-");
		const outsideFile = join(outside, "probe.ts");
		writeFileSync(outsideFile, "export const value = 1;\n");

		const resolved = runWithRequestContext(createStandaloneMcpRequestContext({ cwd: root }), () =>
			resolveReadablePathInsideContext(outsideFile),
		);

		expect(resolved).toBe(realpathSync(outsideFile));
	});

	it("#given an outside file inside its own marked project #when inferring workspace #then uses that project root", () => {
		const root = tempRoot("lsp-outcwd-marker-root-");
		const outside = tempRoot("lsp-outcwd-marker-outside-");
		mkdirSync(join(outside, ".git"), { recursive: true });
		mkdirSync(join(outside, "src"), { recursive: true });
		const outsideFile = join(outside, "src", "probe.ts");
		writeFileSync(outsideFile, "export const value = 1;\n");

		const workspace = runWithRequestContext(createStandaloneMcpRequestContext({ cwd: root }), () =>
			findWorkspaceRoot(outsideFile),
		);

		expect(workspace).toBe(realpathSync(outside));
	});

	it("#given an outside file without any marker #when inferring workspace #then falls back to its own directory", () => {
		const root = tempRoot("lsp-outcwd-nomarker-root-");
		const outside = tempRoot("lsp-outcwd-nomarker-outside-");
		const outsideFile = join(outside, "probe.ts");
		writeFileSync(outsideFile, "export const value = 1;\n");

		const workspace = runWithRequestContext(createStandaloneMcpRequestContext({ cwd: root }), () =>
			findWorkspaceRoot(outsideFile),
		);

		expect(workspace).toBe(realpathSync(outside));
	});

	it("#given an outside file #when resolving a mutating path #then still rejects to keep writes confined", () => {
		const root = tempRoot("lsp-outcwd-write-root-");
		const outside = tempRoot("lsp-outcwd-write-outside-");
		const outsideFile = join(outside, "probe.ts");
		writeFileSync(outsideFile, "export const value = 1;\n");

		expect(() =>
			runWithRequestContext(createStandaloneMcpRequestContext({ cwd: root }), () =>
				resolvePathInsideContext(outsideFile),
			),
		).toThrow(LspInvalidPathError);
	});
});
