import { describe, expect, it } from "bun:test";
import { join } from "node:path";

import { runCodegraphServe } from "../src/serve.ts";

describe("runCodegraphServe provisioning", () => {
	it("#given CodeGraph is unresolved #when serving MCP #then provisions CodeGraph before spawning", async () => {
		// given
		const binPath = join("/tmp/home/.omo/codegraph", "bin", "codegraph");
		const calls: Array<{
			readonly args: readonly string[];
			readonly command: string;
			readonly env: Record<string, string | undefined>;
		}> = [];
		const stderr: string[] = [];

		// when
		const exitCode = await runCodegraphServe({
			config: { codegraph: { enabled: true }, sources: [], warnings: [] },
			env: { PATH: "/bin" },
			homeDir: "/tmp/home",
			nodeVersion: "22.14.0",
			buildEnv: () => ({}),
			resolve: () => ({ argsPrefix: [], command: "codegraph", exists: false, source: "path" }),
			ensureProvisioned: (options) =>
				Promise.resolve({
					binPath: join(options.installDir ?? "/tmp/home/.omo/codegraph", "bin", "codegraph"),
					provisioned: true,
				}),
			runProcess: (command, args, options) => {
				calls.push({ args, command, env: options.env });
				return Promise.resolve(0);
			},
			stderr: { write: (chunk: string) => stderr.push(chunk) },
		});

		// then
		expect(exitCode).toBe(0);
		expect(stderr).toEqual([]);
		expect(calls).toEqual([
			{
				args: ["serve", "--mcp"],
				command: binPath,
				env: { CODEGRAPH_NO_DAEMON: "1", PATH: "/bin" },
			},
		]);
	});
});
