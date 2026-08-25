import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "bun:test";

import { createStandaloneMcpRequestContext, runWithRequestContext } from "../request-context.js";
import { findWorkspaceRoot, resolveReadablePathInsideContext, withLspClient } from "./client-wrapper.js";
import { LspInvalidPathError } from "./errors.js";
import { LspManager } from "./manager.js";

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

	it("#given an absolute file outside context cwd #when resolving #then infers the file's own project root", () => {
		const root = tempRoot("lsp-client-wrapper-cwd-");
		const outside = tempRoot("lsp-client-wrapper-outside-");
		mkdirSync(join(outside, ".git"), { recursive: true });
		writeFileSync(join(outside, "file.ts"), "export const outside = true;\n");

		const workspace = runWithRequestContext(createStandaloneMcpRequestContext({ cwd: root }), () =>
			findWorkspaceRoot(join(outside, "file.ts")),
		);

		expect(workspace).toBe(realpathSync(outside));
	});

	it("#given a symlink inside cwd that points outside #when resolving read path #then keeps lexical path and cwd root", () => {
		const root = tempRoot("lsp-client-wrapper-symlink-root-");
		const outside = tempRoot("lsp-client-wrapper-symlink-outside-");
		mkdirSync(join(root, ".git"), { recursive: true });
		mkdirSync(join(outside, ".git"), { recursive: true });
		writeFileSync(join(outside, "file.ts"), "export const outside = true;\n");
		symlinkSync(outside, join(root, "linked"));

		const result = runWithRequestContext(createStandaloneMcpRequestContext({ cwd: root }), () => ({
			filePath: resolveReadablePathInsideContext("linked/file.ts"),
			workspaceRoot: findWorkspaceRoot("linked/file.ts"),
		}));

		expect(result.filePath).toBe(join(realpathSync(root), "linked", "file.ts"));
		expect(result.workspaceRoot).toBe(realpathSync(root));
	});

	it("#given an absolute macOS alias path through an outside symlink #when resolving read path #then preserves the lexical suffix", () => {
		const root = tempRoot("lsp-client-wrapper-alias-root-");
		const outside = tempRoot("lsp-client-wrapper-alias-outside-");
		mkdirSync(join(root, ".git"), { recursive: true });
		writeFileSync(join(outside, "file.ts"), "export const outside = true;\n");
		symlinkSync(outside, join(root, "linked"));

		const result = runWithRequestContext(createStandaloneMcpRequestContext({ cwd: root }), () =>
			resolveReadablePathInsideContext(join(root, "linked", "file.ts")),
		);

		expect(result).toBe(join(realpathSync(root), "linked", "file.ts"));
	});

	it("#given missing parent directories without markers #when resolving workspace #then uses an existing directory", () => {
		const root = tempRoot("lsp-client-wrapper-missing-root-");
		const workspace = runWithRequestContext(createStandaloneMcpRequestContext({ cwd: root }), () =>
			findWorkspaceRoot("missing/deep/file.ts"),
		);

		expect(workspace).toBe(realpathSync(root));
	});

	it("#given a symlink inside cwd that points outside #when starting rename #then rejects before client acquisition", async () => {
		const root = tempRoot("lsp-client-wrapper-rename-root-");
		const outside = tempRoot("lsp-client-wrapper-rename-outside-");
		writeFileSync(join(outside, "file.ts"), "export const outside = true;\n");
		symlinkSync(outside, join(root, "linked"));
		let clientFactoryCalls = 0;
		const manager = new LspManager({
			clientFactory: () => {
				clientFactoryCalls += 1;
				throw new Error("client acquisition must not start");
			},
		});

		try {
			await expect(
				runWithRequestContext(createStandaloneMcpRequestContext({ cwd: root }), () =>
					withLspClient("linked/file.ts", async () => undefined, "rename", { manager }),
				),
			).rejects.toThrow(LspInvalidPathError);
			expect(clientFactoryCalls).toBe(0);
		} finally {
			await manager.stopAll();
		}
	});
});
