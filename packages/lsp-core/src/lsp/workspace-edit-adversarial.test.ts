import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { afterEach, describe, expect, it } from "bun:test";

import { applyWorkspaceEdit, planWorkspaceEdit } from "./workspace-edit.js";

const tempDirectories: string[] = [];

afterEach(() => {
	for (const directory of tempDirectories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe("workspace edit adversarial inputs", () => {
	it("#given malformed and decorated URIs #when planned #then every variant is rejected before mutation", () => {
		const workspace = makeTempDirectory("lsp-workspace-");
		const source = join(workspace, "source.ts");
		writeFileSync(source, "const before = 1;\n", "utf-8");
		const decorated = `${pathToFileURL(source).href}?query=forbidden`;

		for (const uri of ["untitled:source.ts", decorated, "file:///%ZZ"] as const) {
			const result = planWorkspaceEdit({ changes: { [uri]: [insertion()] } }, workspace);
			expect(result.success).toBe(false);
		}
		expect(readFileSync(source, "utf-8")).toBe("const before = 1;\n");
	});

	it("#given invalid ranges and resource options #when planned #then each failure retains its operation index", () => {
		const workspace = makeTempDirectory("lsp-workspace-");
		const source = join(workspace, "source.ts");
		const created = join(workspace, "created.ts");
		writeFileSync(source, "const before = 1;\n", "utf-8");
		const invalidRange = planWorkspaceEdit(
			{
				documentChanges: [
					{
						textDocument: { uri: pathToFileURL(source).href, version: null },
						edits: [
							{
								range: { start: { line: 0, character: -1 }, end: { line: 0, character: 2 } },
								newText: "bad",
							},
						],
					},
				],
			},
			workspace,
		);
		const invalidOption = planWorkspaceEdit(
			{
				documentChanges: [
					{
						textDocument: { uri: pathToFileURL(source).href, version: null },
						edits: [],
					},
					{ kind: "create", uri: pathToFileURL(created).href, options: { overwrite: "yes" } },
				],
			},
			workspace,
		);

		expect(invalidRange.success).toBe(false);
		if (!invalidRange.success) expect(invalidRange.result.errors[0]).toContain("change 0");
		expect(invalidOption.success).toBe(false);
		if (!invalidOption.success) expect(invalidOption.result.errors[0]).toContain("change 1");
		expect(readFileSync(source, "utf-8")).toBe("const before = 1;\n");
	});

	it("#given an outside target and a dirty unrelated file #when prevalidation fails #then neither is touched", () => {
		const workspace = makeTempDirectory("lsp-workspace-");
		const outside = makeTempDirectory("lsp-outside-");
		const dirty = join(workspace, "dirty.ts");
		const outsideFile = join(outside, "outside.ts");
		writeFileSync(dirty, "user-owned dirty bytes\n", "utf-8");
		writeFileSync(outsideFile, "outside bytes\n", "utf-8");

		const result = applyWorkspaceEdit(
			{ changes: { [pathToFileURL(outsideFile).href]: [insertion()] } },
			{ workspaceRoot: workspace },
		);

		expect(result.success).toBe(false);
		expect(result.errors.join("\n")).toContain("outside workspace");
		expect(readFileSync(dirty, "utf-8")).toBe("user-owned dirty bytes\n");
		expect(readFileSync(outsideFile, "utf-8")).toBe("outside bytes\n");
	});

	it("#given annotations or mixed edit representations #when planned #then unsupported claims are rejected", () => {
		const workspace = makeTempDirectory("lsp-workspace-");
		const unsupported = [
			{ changeAnnotations: { change: { label: "unsupported" } } },
			{ changes: {}, documentChanges: [] },
			{ documentChanges: [{ kind: "create", uri: "file:///missing", annotationId: "change" }] },
		];

		for (const edit of unsupported) expect(planWorkspaceEdit(edit, workspace).success).toBe(false);
	});
});

function insertion() {
	return {
		range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
		newText: "x",
	};
}

function makeTempDirectory(prefix: string): string {
	const directory = mkdtempSync(join(tmpdir(), prefix));
	tempDirectories.push(directory);
	return directory;
}
