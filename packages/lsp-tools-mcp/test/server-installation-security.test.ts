import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { isServerInstalled } from "../src/lsp/server-installation.js";

const tempDirectories: string[] = [];

afterEach(() => {
	for (const directory of tempDirectories.splice(0)) {
		rmSync(directory, { recursive: true, force: true });
	}
});

describe("server installation security", () => {
	it("#given only a project-local node_modules binary #when checking builtin server availability #then it is not trusted", () => {
		// given
		const previousCwd = process.cwd();
		const previousPath = process.env["PATH"];
		const root = mkdtempSync(join(tmpdir(), "lsp-project-bin-"));
		tempDirectories.push(root);
		const binDir = join(root, "node_modules", ".bin");
		mkdirSync(binDir, { recursive: true });
		const binaryPath = join(binDir, "typescript-language-server");
		writeFileSync(binaryPath, "#!/bin/sh\nexit 0\n");
		chmodSync(binaryPath, 0o755);
		process.env["PATH"] = join(root, "empty-path");

		try {
			// when
			const installed = isServerInstalled(["typescript-language-server", "--stdio"], root);

			// then
			expect(installed).toBe(false);
		} finally {
			expect(process.cwd()).toBe(previousCwd);
			if (previousPath === undefined) {
				delete process.env["PATH"];
			} else {
				process.env["PATH"] = previousPath;
			}
		}
	});

	it("#given server binary is on PATH #when checking builtin server availability #then it is accepted", () => {
		// given
		const previousPath = process.env["PATH"];
		const root = mkdtempSync(join(tmpdir(), "lsp-path-bin-"));
		tempDirectories.push(root);
		const binaryPath = join(root, "typescript-language-server");
		writeFileSync(binaryPath, "#!/bin/sh\nexit 0\n");
		chmodSync(binaryPath, 0o755);
		process.env["PATH"] = root;

		try {
			// when
			const installed = isServerInstalled(["typescript-language-server", "--stdio"]);

			// then
			expect(installed).toBe(true);
		} finally {
			if (previousPath === undefined) {
				delete process.env["PATH"];
			} else {
				process.env["PATH"] = previousPath;
			}
		}
	});
});
