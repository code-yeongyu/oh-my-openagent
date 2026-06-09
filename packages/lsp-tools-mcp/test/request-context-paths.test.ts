import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { findWorkspaceRoot } from "../src/lsp/client-wrapper.js";
import { runWithRequestContext } from "../src/request-context.js";

const tempDirectories: string[] = [];

afterEach(() => {
	for (const directory of tempDirectories.splice(0)) {
		rmSync(directory, { recursive: true, force: true });
	}
});

describe("path resolution honors request context cwd", () => {
	it("#given a relative path and a context cwd with a workspace marker #when findWorkspaceRoot #then resolves against the context cwd", () => {
		const root = mkdtempSync(join(tmpdir(), "lsp-ctx-root-"));
		tempDirectories.push(root);
		mkdirSync(join(root, ".git"), { recursive: true });
		mkdirSync(join(root, "sub"), { recursive: true });
		writeFileSync(join(root, "sub", "file.ts"), "export const value = 1;\n");

		const resolved = runWithRequestContext({ cwd: root }, () => findWorkspaceRoot("sub/file.ts"));

		expect(resolved).toBe(root);
	});
});
