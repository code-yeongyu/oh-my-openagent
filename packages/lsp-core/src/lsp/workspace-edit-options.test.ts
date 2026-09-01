import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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

describe("applyWorkspaceEdit resource options", () => {
	it("#given create ignoreIfExists #when the target exists #then existing bytes are preserved", () => {
		// given
		const workspace = makeTempDirectory();
		const target = join(workspace, "target.ts");
		writeFileSync(target, "preserve\n", "utf-8");

		// when
		const result = applyWorkspaceEdit(
			{
				documentChanges: [
					{ kind: "create", uri: pathToFileURL(target).href, options: { ignoreIfExists: true } },
				],
			},
			{ workspaceRoot: workspace },
		);

		// then
		expect(result.success).toBe(true);
		expect(result.filesModified).toEqual([]);
		expect(readFileSync(target, "utf-8")).toBe("preserve\n");
	});

	it("#given rename ignoreIfExists #when the destination exists #then both files are preserved", () => {
		// given
		const workspace = makeTempDirectory();
		const source = join(workspace, "source.ts");
		const destination = join(workspace, "destination.ts");
		writeFileSync(source, "source\n", "utf-8");
		writeFileSync(destination, "destination\n", "utf-8");

		// when
		const result = applyWorkspaceEdit(
			{
				documentChanges: [
					{
						kind: "rename",
						oldUri: pathToFileURL(source).href,
						newUri: pathToFileURL(destination).href,
						options: { ignoreIfExists: true },
					},
				],
			},
			{ workspaceRoot: workspace },
		);

		// then
		expect(result.success).toBe(true);
		expect(result.filesModified).toEqual([]);
		expect(readFileSync(source, "utf-8")).toBe("source\n");
		expect(readFileSync(destination, "utf-8")).toBe("destination\n");
	});

	it("#given rename overwrite #when the destination exists #then source replaces destination", () => {
		// given
		const workspace = makeTempDirectory();
		const source = join(workspace, "source.ts");
		const destination = join(workspace, "destination.ts");
		writeFileSync(source, "source\n", "utf-8");
		writeFileSync(destination, "destination\n", "utf-8");

		// when
		const result = applyWorkspaceEdit(
			{
				documentChanges: [
					{
						kind: "rename",
						oldUri: pathToFileURL(source).href,
						newUri: pathToFileURL(destination).href,
						options: { overwrite: true },
					},
				],
			},
			{ workspaceRoot: workspace },
		);

		// then
		expect(result.success).toBe(true);
		expect(existsSync(source)).toBe(false);
		expect(readFileSync(destination, "utf-8")).toBe("source\n");
	});

	it("#given delete ignoreIfNotExists #when the target is missing #then it is a successful no-op", () => {
		// given
		const workspace = makeTempDirectory();
		const target = join(workspace, "missing.ts");

		// when
		const result = applyWorkspaceEdit(
			{
				documentChanges: [
					{ kind: "delete", uri: pathToFileURL(target).href, options: { ignoreIfNotExists: true } },
				],
			},
			{ workspaceRoot: workspace },
		);

		// then
		expect(result.success).toBe(true);
		expect(result.filesModified).toEqual([]);
	});

	it("#given recursive delete #when the target is a non-empty directory #then the subtree is removed", () => {
		// given
		const workspace = makeTempDirectory();
		const target = join(workspace, "nested");
		mkdirSync(target);
		writeFileSync(join(target, "child.ts"), "child\n", "utf-8");

		// when
		const result = applyWorkspaceEdit(
			{
				documentChanges: [
					{ kind: "delete", uri: pathToFileURL(target).href, options: { recursive: true } },
				],
			},
			{ workspaceRoot: workspace },
		);

		// then
		expect(result.success).toBe(true);
		expect(existsSync(target)).toBe(false);
	});
});

function makeTempDirectory(): string {
	const directory = mkdtempSync(join(tmpdir(), "lsp-workspace-options-"));
	tempDirectories.push(directory);
	return directory;
}
