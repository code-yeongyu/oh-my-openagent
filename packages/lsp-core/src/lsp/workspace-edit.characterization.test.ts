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

describe("applyWorkspaceEdit preserved behavior", () => {
	it("#given a valid text edit #when applied #then the file and ApplyResult remain compatible", () => {
		// given
		const workspace = makeTempDirectory();
		const source = join(workspace, "source.ts");
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
		expect(result).toEqual({ success: true, filesModified: [source], totalEdits: 1, errors: [] });
		expect(readFileSync(source, "utf-8")).toBe("const after = 1;\n");
	});

	it("#given a resource rename #when applied #then content moves and the destination is reported", () => {
		// given
		const workspace = makeTempDirectory();
		const source = join(workspace, "before.ts");
		const destination = join(workspace, "after.ts");
		writeFileSync(source, "export const value = 1;\n", "utf-8");

		// when
		const result = applyWorkspaceEdit(
			{
				documentChanges: [
					{ kind: "rename", oldUri: pathToFileURL(source).href, newUri: pathToFileURL(destination).href },
				],
			},
			{ workspaceRoot: workspace },
		);

		// then
		expect(result).toEqual({ success: true, filesModified: [destination], totalEdits: 0, errors: [] });
		expect(existsSync(source)).toBe(false);
		expect(readFileSync(destination, "utf-8")).toBe("export const value = 1;\n");
	});

	it("#given an empty workspace edit #when applied #then it remains a successful no-op", () => {
		// given
		const workspace = makeTempDirectory();

		// when
		const result = applyWorkspaceEdit({}, { workspaceRoot: workspace });

		// then
		expect(result).toEqual({ success: true, filesModified: [], totalEdits: 0, errors: [] });
	});

	it("#given no workspace edit #when applied #then the existing failure remains explicit", () => {
		// given
		const workspace = makeTempDirectory();

		// when
		const result = applyWorkspaceEdit(null, { workspaceRoot: workspace });

		// then
		expect(result).toEqual({ success: false, filesModified: [], totalEdits: 0, errors: ["No edit provided"] });
	});
});

function makeTempDirectory(): string {
	const directory = mkdtempSync(join(tmpdir(), "lsp-workspace-characterization-"));
	tempDirectories.push(directory);
	return directory;
}
