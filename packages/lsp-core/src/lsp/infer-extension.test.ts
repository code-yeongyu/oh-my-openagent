import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "bun:test";

import { inferExtensionFromDirectory } from "./infer-extension.js";

const tempDirectories: string[] = [];

afterEach(() => {
	for (const directory of tempDirectories.splice(0)) {
		rmSync(directory, { recursive: true, force: true });
	}
});

describe("inferExtensionFromDirectory", () => {
	test("#given uppercase TypeScript files #when inferring extension #then counts them as lowercase extensions", () => {
		// given
		const root = mkdtempSync(join(tmpdir(), "omo-lsp-infer-"));
		tempDirectories.push(root);
		mkdirSync(join(root, "src"), { recursive: true });
		writeFileSync(join(root, "src", "APP.TS"), "export const app = 1;\n");
		writeFileSync(join(root, "src", "VIEW.TSX"), "export const View = () => null;\n");
		writeFileSync(join(root, "src", "widget.TSX"), "export const Widget = () => null;\n");

		// when
		const extension = inferExtensionFromDirectory(root);

		// then
		expect(extension).toBe(".tsx");
	});
});
