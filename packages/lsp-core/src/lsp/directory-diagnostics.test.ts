import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";

import { collectFilesWithExtension } from "./directory-diagnostics.js";

const tempDirectories: string[] = [];

afterEach(() => {
	for (const directory of tempDirectories.splice(0)) {
		rmSync(directory, { recursive: true, force: true });
	}
});

describe("collectFilesWithExtension", () => {
	test("#given uppercase extension input #when collecting diagnostics inputs #then lowercase matching files are included", () => {
		// given
		const root = mkdtempSync(join(tmpdir(), "omo-lsp-directory-"));
		tempDirectories.push(root);
		mkdirSync(join(root, "src"), { recursive: true });
		writeFileSync(join(root, "src", "app.ts"), "export const value = 1;\n");
		writeFileSync(join(root, "src", "notes.md"), "# Notes\n");

		// when
		const files = collectFilesWithExtension(root, ".TS", 10);

		// then
		expect(files.map((file) => basename(file))).toEqual(["app.ts"]);
	});
});
