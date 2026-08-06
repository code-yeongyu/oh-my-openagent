import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { inferExtensionFromDirectory } from "../src/lsp/infer-extension.js";

const tempDirectories: string[] = [];

afterEach(() => {
	for (const directory of tempDirectories.splice(0)) {
		rmSync(directory, { recursive: true, force: true });
	}
});

describe("inferExtensionFromDirectory", () => {
	it("#given a directory dominated by basename Dockerfiles #when inferring its extension #then resolves to .dockerfile", () => {
		// given
		const root = mkdtempSync(join(tmpdir(), "codex-lsp-infer-"));
		tempDirectories.push(root);
		writeFileSync(join(root, "Dockerfile"), "FROM alpine\n");
		writeFileSync(join(root, "Containerfile"), "FROM alpine\n");
		writeFileSync(join(root, "notes.ts"), "export const value = 1;\n");

		// when
		const ext = inferExtensionFromDirectory(root);

		// then
		expect(ext).toBe(".dockerfile");
	});
});
