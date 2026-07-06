import { describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { runCodegraphCli } from "../src/cli.ts";

describe("CodeGraph sweep CLI", () => {
	it("#given sweep dry-run args with an injected root #when invoked #then it reports candidates as JSON and does not kill", async () => {
		// given
		const homeDir = mkdtempSync(join(tmpdir(), "omo-codegraph-sweep-cli-home-"));
		const root = join(homeDir, ".codex", "plugins", "cache", "sisyphuslabs", "omo", "4.15.1");
		const stdout: string[] = [];
		const killed: string[] = [];
		try {
			// when
			const exitCode = await runCodegraphCli({
				argv: ["node", "cli.js", "sweep", "--dry-run", "--force", "--root", root],
				env: { HOME: homeDir },
				stdout: { write: (chunk) => stdout.push(chunk) },
				sweepOptions: {
					killer: {
						isAlive: () => true,
						kill: (pid) => {
							killed.push(`kill:${pid}`);
							return Promise.resolve();
						},
						terminate: (pid) => {
							killed.push(`term:${pid}`);
							return Promise.resolve();
						},
					},
					processProvider: () => Promise.resolve([
						{
							command: `${process.execPath} ${root}/components/codegraph/dist/serve.js`,
							pid: 601,
							ppid: 1,
						},
					]),
				},
			});

			// then
			expect(exitCode).toBe(0);
			expect(killed).toEqual([]);
			expect(JSON.parse(stdout.join(""))).toMatchObject({
				action: "swept",
				candidates: [{ pid: 601 }],
				dryRun: true,
				killed: [],
			});
		} finally {
			rmSync(homeDir, { force: true, recursive: true });
		}
	});
});
