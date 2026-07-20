import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { afterEach, describe, expect, it } from "bun:test";

import { applyWorkspaceEdit } from "./workspace-edit.js";

const tempDirectories: string[] = [];

afterEach(() => {
	for (const directory of tempDirectories.splice(0)) {
		rmSync(directory, { recursive: true, force: true });
	}
});

describe("applyWorkspaceEdit prevalidation", () => {
	it("#given a valid edit before an overlapping edit #when validated #then neither file is mutated", () => {
		// given
		const workspace = makeTempDirectory();
		const validFile = join(workspace, "valid.ts");
		const invalidFile = join(workspace, "invalid.ts");
		writeFileSync(validFile, "const valid = 1;\n", "utf-8");
		writeFileSync(invalidFile, "const invalid = 2;\n", "utf-8");

		// when
		const result = applyWorkspaceEdit(
			{
				changes: {
					[pathToFileURL(validFile).href]: [edit(0, [6, 11], "changed")],
					[pathToFileURL(invalidFile).href]: [edit(0, [0, 10], "first"), edit(0, [5, 13], "second")],
				},
			},
			{ workspaceRoot: workspace },
		);

		// then
		expect(result.success).toBe(false);
		expect(result.filesModified).toEqual([]);
		expect(readFileSync(validFile, "utf-8")).toBe("const valid = 1;\n");
		expect(readFileSync(invalidFile, "utf-8")).toBe("const invalid = 2;\n");
	});

	it("#given byte-identical non-empty edits #when applied #then one edit is committed", () => {
		// given
		const workspace = makeTempDirectory();
		const source = join(workspace, "source.ts");
		writeFileSync(source, "const before = 1;\n", "utf-8");
		const replacement = edit(0, [6, 12], "after");

		// when
		const result = applyWorkspaceEdit(
			{ changes: { [pathToFileURL(source).href]: [replacement, replacement] } },
			{ workspaceRoot: workspace },
		);

		// then
		expect(result.success).toBe(true);
		expect(result.totalEdits).toBe(1);
		expect(readFileSync(source, "utf-8")).toBe("const after = 1;\n");
	});

	it("#given equal-position insertions #when applied #then all insertions retain declared order", () => {
		// given
		const workspace = makeTempDirectory();
		const source = join(workspace, "source.ts");
		writeFileSync(source, "abc", "utf-8");

		// when
		const result = applyWorkspaceEdit(
			{
				changes: {
					[pathToFileURL(source).href]: [edit(0, [1, 1], "X"), edit(0, [1, 1], "X"), edit(0, [1, 1], "Y")],
				},
			},
			{ workspaceRoot: workspace },
		);

		// then
		expect(result.success).toBe(true);
		expect(result.totalEdits).toBe(3);
		expect(readFileSync(source, "utf-8")).toBe("aXXYbc");
	});

	it("#given a range beyond the snapshot #when validated #then the edit fails without mutation", () => {
		// given
		const workspace = makeTempDirectory();
		const source = join(workspace, "source.ts");
		writeFileSync(source, "short\n", "utf-8");

		// when
		const result = applyWorkspaceEdit(
			{ changes: { [pathToFileURL(source).href]: [edit(4, [0, 1], "invalid")] } },
			{ workspaceRoot: workspace },
		);

		// then
		expect(result.success).toBe(false);
		expect(result.filesModified).toEqual([]);
		expect(readFileSync(source, "utf-8")).toBe("short\n");
	});

	it("#given a create followed by an invalid edit #when the sequence is validated #then no file is created", () => {
		// given
		const workspace = makeTempDirectory();
		const source = join(workspace, "created.ts");
		const uri = pathToFileURL(source).href;

		// when
		const result = applyWorkspaceEdit(
			{
				documentChanges: [
					{ kind: "create", uri },
					{ textDocument: { uri, version: null }, edits: [edit(2, [0, 1], "invalid")] },
				],
			},
			{ workspaceRoot: workspace },
		);

		// then
		expect(result.success).toBe(false);
		expect(result.filesModified).toEqual([]);
		expect(result).toMatchObject({ failedChange: 1 });
		expect(result.errors.join("\n")).toContain("change 1");
		expect(existsSync(source)).toBe(false);
	});

	it("#given rename then text edit of the destination #when applied #then declared order uses virtual state", () => {
		// given
		const workspace = makeTempDirectory();
		const source = join(workspace, "before.ts");
		const destination = join(workspace, "after.ts");
		writeFileSync(source, "const before = 1;\n", "utf-8");
		const sourceUri = pathToFileURL(source).href;
		const destinationUri = pathToFileURL(destination).href;

		// when
		const result = applyWorkspaceEdit(
			{
				documentChanges: [
					{ kind: "rename", oldUri: sourceUri, newUri: destinationUri },
					{
						textDocument: { uri: destinationUri, version: null },
						edits: [edit(0, [6, 12], "after")],
					},
				],
			},
			{ workspaceRoot: workspace },
		);

		// then
		expect(result.success).toBe(true);
		expect(existsSync(source)).toBe(false);
		expect(readFileSync(destination, "utf-8")).toBe("const after = 1;\n");
	});
});

function edit(line: number, characters: readonly [start: number, end: number], newText: string) {
	const [startCharacter, endCharacter] = characters;
	return {
		range: {
			start: { line, character: startCharacter },
			end: { line, character: endCharacter },
		},
		newText,
	};
}

function makeTempDirectory(): string {
	const directory = mkdtempSync(join(tmpdir(), "lsp-workspace-prevalidation-"));
	tempDirectories.push(directory);
	return directory;
}
