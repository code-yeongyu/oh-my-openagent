import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const packageRoot = fileURLToPath(new URL("..", import.meta.url));
const cleanScript = join(packageRoot, "scripts", "clean-dist.mjs");

describe("clean daemon build output", () => {
	const tempDirs: string[] = [];

	afterEach(() => {
		for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
	});

	it("#given stale generated files #when clean-dist runs #then the entire old dist tree is removed", () => {
		// given
		const root = mkdtempSync(join(tmpdir(), "lsp-clean-dist-"));
		tempDirs.push(root);
		const dist = join(root, "dist");
		mkdirSync(join(dist, "stale"), { recursive: true });
		writeFileSync(join(dist, "obsolete.js"), "old\n");
		writeFileSync(join(dist, "stale", "nested.d.ts"), "old\n");

		// when
		execFileSync(process.execPath, [cleanScript, dist]);

		// then
		expect(existsSync(dist)).toBe(false);
	});

	it("#given the daemon package scripts #when inspecting build #then clean-dist is the first build action", () => {
		const manifest = JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf8")) as {
			scripts?: Record<string, string>;
		};
		expect(manifest.scripts?.["build"]?.startsWith("node scripts/clean-dist.mjs && ")).toBe(true);
	});
});
