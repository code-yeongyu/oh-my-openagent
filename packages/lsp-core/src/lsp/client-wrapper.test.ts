import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "bun:test";

import { createStandaloneMcpRequestContext, runWithRequestContext } from "../request-context.js";
import { findWorkspaceRoot, resolvePathInsideContext } from "./client-wrapper.js";
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

describe("LSP client path confinement", () => {
	it("#given a relative file inside context cwd #when resolving workspace #then marker search stays inside cwd", () => {
		const root = tempRoot("lsp-client-wrapper-root-");
		mkdirSync(join(root, ".git"), { recursive: true });
		mkdirSync(join(root, "src"), { recursive: true });
		writeFileSync(join(root, "src", "file.ts"), "export const value = 1;\n");

		const workspace = runWithRequestContext(createStandaloneMcpRequestContext({ cwd: root }), () =>
			findWorkspaceRoot("src/file.ts"),
		);

		expect(workspace).toBe(realpathSync(root));
	});

	it("#given an absolute file outside context cwd #when resolving #then rejects before workspace inference", () => {
		const root = tempRoot("lsp-client-wrapper-cwd-");
		const outside = tempRoot("lsp-client-wrapper-outside-");
		mkdirSync(join(outside, ".git"), { recursive: true });
		writeFileSync(join(outside, "file.ts"), "export const outside = true;\n");

		expect(() =>
			runWithRequestContext(createStandaloneMcpRequestContext({ cwd: root }), () =>
				findWorkspaceRoot(join(outside, "file.ts")),
			),
		).toThrow(LspInvalidPathError);
	});

	it("#given a symlink inside cwd that points outside #when resolving #then rejects the escape", () => {
		const root = tempRoot("lsp-client-wrapper-symlink-root-");
		const outside = tempRoot("lsp-client-wrapper-symlink-outside-");
		writeFileSync(join(outside, "file.ts"), "export const outside = true;\n");
		symlinkSync(outside, join(root, "linked"));

		expect(() =>
			runWithRequestContext(createStandaloneMcpRequestContext({ cwd: root }), () =>
				resolvePathInsideContext("linked/file.ts"),
			),
		).toThrow(LspInvalidPathError);
	});
});

describe("findWorkspaceRoot marker priority", () => {
	// given a project root with .git and a nested sub-package that has its own pyproject.toml
	// when resolving workspace root for a file inside the sub-package
	// then .git at the project root takes priority over the nearer pyproject.toml
	it("#given .git at project root and nested pyproject.toml in sub-package #when resolving #then prefers .git over nearer pyproject.toml", () => {
		const root = tempRoot("lsp-ws-priority-git-");
		mkdirSync(join(root, ".git"), { recursive: true });
		mkdirSync(join(root, "src", "modex_graph"), { recursive: true });
		writeFileSync(join(root, "src", "modex_graph", "pyproject.toml"), "[project]\nname = 'modex-graph'\n");
		writeFileSync(join(root, "src", "modex_graph", "compiled_graph.py"), "x = 1\n");

		const workspace = runWithRequestContext(createStandaloneMcpRequestContext({ cwd: root }), () =>
			findWorkspaceRoot("src/modex_graph/compiled_graph.py"),
		);

		expect(workspace).toBe(realpathSync(root));
	});

	// given a sub-package with pyproject.toml but NO .git anywhere up the tree
	// when resolving workspace root for a file inside the sub-package
	// then falls back to the first non-.git marker (pyproject.toml directory)
	it("#given nested pyproject.toml and no .git anywhere #when resolving #then falls back to first non-git marker", () => {
		const root = tempRoot("lsp-ws-priority-fallback-");
		mkdirSync(join(root, "src", "modex_graph"), { recursive: true });
		writeFileSync(join(root, "src", "modex_graph", "pyproject.toml"), "[project]\nname = 'modex-graph'\n");
		writeFileSync(join(root, "src", "modex_graph", "compiled_graph.py"), "x = 1\n");

		const workspace = runWithRequestContext(createStandaloneMcpRequestContext({ cwd: root }), () =>
			findWorkspaceRoot("src/modex_graph/compiled_graph.py"),
		);

		expect(workspace).toBe(realpathSync(join(root, "src", "modex_graph")));
	});

	// given a directory with both .git and pyproject.toml at the same level
	// when resolving workspace root
	// then returns that directory (both markers agree)
	it("#given .git and pyproject.toml at same level #when resolving #then returns that directory", () => {
		const root = tempRoot("lsp-ws-priority-same-level-");
		mkdirSync(join(root, ".git"), { recursive: true });
		writeFileSync(join(root, "pyproject.toml"), "[project]\nname = 'my-project'\n");
		mkdirSync(join(root, "src"), { recursive: true });
		writeFileSync(join(root, "src", "main.py"), "x = 1\n");

		const workspace = runWithRequestContext(createStandaloneMcpRequestContext({ cwd: root }), () =>
			findWorkspaceRoot("src/main.py"),
		);

		expect(workspace).toBe(realpathSync(root));
	});

});
