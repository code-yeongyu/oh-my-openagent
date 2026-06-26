import { describe, expect, it } from "bun:test";
import { rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const componentRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

describe("runCodegraphServe option types", () => {
	it("#given direct-process and proxy injectables are mixed #when typechecking serve options #then the public type rejects them", () => {
		// given
		const probePath = join(componentRoot, ".serve-options-probe.ts");
		writeFileSync(
			probePath,
			[
				'import type { RunCodegraphServeOptions } from "./src/serve.ts";',
				"const mixed: RunCodegraphServeOptions = {",
				"  runProcess: () => Promise.resolve(0),",
				"  spawnServer: () => ({",
				"    input: process.stdout,",
				"    output: process.stdin,",
				"    error: process.stdin,",
				"    terminate: () => undefined,",
				"    wait: () => Promise.resolve(0),",
				"  }),",
				"};",
				"void mixed;",
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
			expect(`${result.stdout}\n${result.stderr}`).toContain("RunCodegraphServeOptions");
		} finally {
			rmSync(probePath, { force: true });
		}
	});
});

function tscPath(): string {
	return join(componentRoot, "..", "..", "node_modules", ".bin", "tsc");
}
