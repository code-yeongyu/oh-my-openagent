import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { scanRuleFiles } from "../src/rules/scanner.js";

const tempDirectories: string[] = [];

afterEach(() => {
	for (const directory of tempDirectories.splice(0)) {
		rmSync(directory, { recursive: true, force: true });
	}
});

describe("scanRuleFiles", () => {
	it("#given more rule files than max #when scanning #then returns only capped files", () => {
		// given
		const root = mkdtempSync(join(tmpdir(), "codex-rules-scanner-"));
		tempDirectories.push(root);
		for (let index = 0; index < 5; index += 1) {
			writeFileSync(join(root, `rule-${index}.md`), `Rule ${index}\n`);
		}

		// when
		const files = scanRuleFiles({ rootDir: root, maxFiles: 2 });

		// then
		expect(files).toHaveLength(2);
	});

	it("#given rule files and an excluded directory #when scanning #then returns sorted non-excluded files", () => {
		// given
		const root = mkdtempSync(join(tmpdir(), "codex-rules-scanner-"));
		tempDirectories.push(root);
		mkdirSync(join(root, "dist"), { recursive: true });
		writeFileSync(join(root, "beta.md"), "Beta\n");
		writeFileSync(join(root, "alpha.md"), "Alpha\n");
		writeFileSync(join(root, "dist", "ignored.md"), "Ignored\n");

		// when
		const files = scanRuleFiles({ rootDir: root });

		// then
		expect(files.map((file) => file.path)).toEqual([join(root, "alpha.md"), join(root, "beta.md")]);
	});

	it("#given symlink loop #when scanning #then traversal terminates without duplicate files", () => {
		// given
		const root = mkdtempSync(join(tmpdir(), "codex-rules-scanner-"));
		tempDirectories.push(root);
		const nested = join(root, "nested");
		mkdirSync(nested, { recursive: true });
		writeFileSync(join(root, "root.md"), "Root\n");
		symlinkSync(root, join(nested, "loop"));

		// when
		const files = scanRuleFiles({ rootDir: root });

		// then
		expect(files.map((file) => file.path)).toEqual([join(root, "root.md")]);
	});
});
