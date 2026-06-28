import { describe, expect, it } from "bun:test";
import { rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const componentRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

describe("runCodegraphServe option types", () => {
	it("#given direct-process injection is used #when typechecking serve options #then the public type rejects it", () => {
		// given
		const probePath = join(componentRoot, ".serve-options-probe.ts");
		writeFileSync(
			probePath,
			[
				'import type { RunCodegraphServeOptions } from "./src/serve.ts";',
				"const directProcess: RunCodegraphServeOptions = {",
				"  runProcess: () => Promise.resolve(0),",
				"};",
				"void directProcess;",
			].join("\n"),
		);

		try {
			// when
			const result = spawnSync(tscPath(), [
				"--noEmit",
				"--ignoreConfig",
				"--allowImportingTsExtensions",
				"--module",
				"ESNext",
				"--moduleResolution",
				"Bundler",
				"--target",
				"ES2022",
				"--types",
				"node,bun-types",
				"--strict",
				"--exactOptionalPropertyTypes",
				"--skipLibCheck",
				probePath,
			], { cwd: componentRoot, encoding: "utf8" });

			// then
			expect(result.status).not.toBe(0);
			expect(`${result.stdout}\n${result.stderr}`).toContain("runProcess");
		} finally {
			rmSync(probePath, { force: true });
		}
	});
});

function tscPath(): string {
	return join(componentRoot, "..", "..", "node_modules", ".bin", "tsc");
}
