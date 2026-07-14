import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "bun:test";

import { aggregateDiagnosticsForDirectory } from "./directory-diagnostics.js";
import type { LspClient } from "./client.js";
import type { Diagnostic, ResolvedServer } from "./types.js";

describe("directory diagnostics", () => {
	it("#given multiple files and one per-file failure #when directory diagnostics run #then work stays bounded and file failures stay structured", async () => {
		const workspace = mkdtempSync(join(tmpdir(), "lsp-directory-diag-"));
		const active: string[] = [];
		let maxActive = 0;
		const diagnosticsByFile = new Map<string, Diagnostic[] | Error>([
			[join(workspace, "a.ts"), [diagnostic("a")]],
			[join(workspace, "b.ts"), new Error("b failed")],
			[join(workspace, "c.ts"), [diagnostic("c")]],
			[join(workspace, "d.ts"), [diagnostic("d")]],
			[join(workspace, "e.ts"), [diagnostic("e")]],
		]);
		const client = {
			async diagnostics(filePath: string) {
				active.push(filePath);
				maxActive = Math.max(maxActive, active.length);
				await Promise.resolve();
				active.splice(active.indexOf(filePath), 1);
				const entry = diagnosticsByFile.get(filePath);
				if (entry instanceof Error) throw entry;
				return { items: entry ?? [] };
			},
		} as Pick<LspClient, "diagnostics"> as LspClient;
		const server: ResolvedServer = { id: "typescript", command: ["typescript-language-server"], extensions: [".ts"], priority: 1 };
		const manager = {
			async getClient() {
				return client;
			},
			releaseClient() {},
		};

		try {
			const result = await aggregateDiagnosticsForDirectory(workspace, ".ts", "all", 4, {
				manager: manager as never,
				listFiles: () => [...diagnosticsByFile.keys()],
				workspaceRoot: workspace,
				server,
				maxConcurrency: 2,
			});

			expect(maxActive).toBeLessThanOrEqual(2);
			expect(result.fileFailures).toEqual([{ file: join(workspace, "b.ts"), error: "b failed" }]);
			expect(result.totalDiagnostics).toBe(3);
			expect(result.output).toContain("File processing errors:");
		} finally {
			rmSync(workspace, { recursive: true, force: true });
		}
	});

	it("#given directory diagnostics are aborted after one file #when the worker loops #then no later file is scheduled", async () => {
		const workspace = mkdtempSync(join(tmpdir(), "lsp-directory-diag-cancel-"));
		const controller = new AbortController();
		const visited: string[] = [];
		const firstFile = join(workspace, "a.ts");
		const files = [firstFile, join(workspace, "b.ts"), join(workspace, "c.ts")];
		const client = {
			async diagnostics(filePath: string) {
				visited.push(filePath);
				controller.abort();
				return { items: [] };
			},
		} as Pick<LspClient, "diagnostics"> as LspClient;
		const server: ResolvedServer = { id: "typescript", command: ["typescript-language-server"], extensions: [".ts"], priority: 1 };
		const manager = {
			async getClient() {
				return client;
			},
			releaseClient() {},
		};

		try {
			const result = await aggregateDiagnosticsForDirectory(workspace, ".ts", "all", 3, {
				manager: manager as never,
				listFiles: () => files,
				workspaceRoot: workspace,
				server,
				maxConcurrency: 1,
				signal: controller.signal,
			});

			expect(result.totalDiagnostics).toBe(0);
			expect(visited).toEqual([firstFile]);
		} finally {
			rmSync(workspace, { recursive: true, force: true });
		}
	});
});

function diagnostic(message: string): Diagnostic {
	return {
		range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } },
		message,
	};
}
