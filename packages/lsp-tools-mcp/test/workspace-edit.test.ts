import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

import { applyWorkspaceEdit } from "../src/lsp/workspace-edit.js";

const tempDirectories: string[] = [];

afterEach(() => {
	for (const directory of tempDirectories.splice(0)) {
		rmSync(directory, { recursive: true, force: true });
	}
});

describe("applyWorkspaceEdit", () => {
	it("#given changes include an outside file URI #when applying edit #then rejects without modifying the outside file", () => {
		// given
		const workspace = makeTempDirectory("lsp-workspace-");
		const outside = makeTempDirectory("lsp-outside-");
		const outsideFile = join(outside, "owned.ts");
		writeFileSync(outsideFile, "const name = 'before';\n", "utf-8");

		// when
		const result = applyWorkspaceEdit(
			{
				changes: {
					[pathToFileURL(outsideFile).href]: [
						{
							range: { start: { line: 0, character: 14 }, end: { line: 0, character: 20 } },
							newText: "after",
						},
					],
				},
			},
			{ workspaceRoot: workspace },
		);

		// then
		expect(result.success).toBe(false);
		expect(result.filesModified).toEqual([]);
		expect(result.errors.join("\n")).toContain("outside workspace");
		expect(readFileSync(outsideFile, "utf-8")).toBe("const name = 'before';\n");
	});

	it("#given documentChanges target outside paths #when applying edit #then rejects create rename and delete operations", () => {
		// given
		const workspace = makeTempDirectory("lsp-workspace-");
		const outside = makeTempDirectory("lsp-outside-");
		const outsideCreate = join(outside, "created.ts");
		const outsideOld = join(outside, "old.ts");
		const outsideNew = join(outside, "new.ts");
		const outsideDelete = join(outside, "delete.ts");
		writeFileSync(outsideOld, "old\n", "utf-8");
		writeFileSync(outsideDelete, "delete\n", "utf-8");

		// when
		const result = applyWorkspaceEdit(
			{
				documentChanges: [
					{ kind: "create", uri: pathToFileURL(outsideCreate).href },
					{ kind: "rename", oldUri: pathToFileURL(outsideOld).href, newUri: pathToFileURL(outsideNew).href },
					{ kind: "delete", uri: pathToFileURL(outsideDelete).href },
				],
			},
			{ workspaceRoot: workspace },
		);

		// then
		expect(result.success).toBe(false);
		expect(result.filesModified).toEqual([]);
		expect(result.errors).toHaveLength(3);
		expect(existsSync(outsideCreate)).toBe(false);
		expect(existsSync(outsideOld)).toBe(true);
		expect(existsSync(outsideNew)).toBe(false);
		expect(existsSync(outsideDelete)).toBe(true);
	});

	it("#given non-file URI #when applying edit #then rejects it", () => {
		// given
		const workspace = makeTempDirectory("lsp-workspace-");

		// when
		const result = applyWorkspaceEdit(
			{
				changes: {
					"untitled:malicious.ts": [
						{
							range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
							newText: "owned",
						},
					],
				},
			},
			{ workspaceRoot: workspace },
		);

		// then
		expect(result.success).toBe(false);
		expect(result.errors.join("\n")).toContain("non-file URI");
	});

	it("#given document edit inside workspace #when applying edit #then updates the file", () => {
		// given
		const workspace = makeTempDirectory("lsp-workspace-");
		const source = join(workspace, "source.ts");
		mkdirSync(workspace, { recursive: true });
		writeFileSync(source, "const before = 1;\n", "utf-8");

		// when
		const result = applyWorkspaceEdit(
			{
				changes: {
					[pathToFileURL(source).href]: [
						{
							range: { start: { line: 0, character: 6 }, end: { line: 0, character: 12 } },
							newText: "after",
						},
					],
				},
			},
			{ workspaceRoot: workspace },
		);

		// then
		expect(result.success).toBe(true);
		expect(result.filesModified).toEqual([source]);
		expect(readFileSync(source, "utf-8")).toBe("const after = 1;\n");
	});
});

function makeTempDirectory(prefix: string): string {
	const directory = mkdtempSync(join(tmpdir(), prefix));
	tempDirectories.push(directory);
	return directory;
}
