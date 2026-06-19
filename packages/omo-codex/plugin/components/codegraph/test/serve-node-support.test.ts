import { describe, expect, it } from "bun:test";

import { CODEGRAPH_UNSAFE_NODE_ENV } from "../../../../../utils/src/codegraph/node-support.ts";
import { runCodegraphServe } from "../src/serve.ts";

describe("runCodegraphServe node support", () => {
	it("#given Node is too new and no command resolves #when serving MCP #then the unsupported-node hint wins", async () => {
		// given
		const stderr: string[] = [];
		const spawned: string[] = [];

		// when
		const exitCode = await runCodegraphServe({
			env: { PATH: "/bin" },
			nodeVersion: "26.3.0",
			buildEnv: () => ({}),
			resolve: () => ({ argsPrefix: [], command: "codegraph", exists: false, source: "path" }),
			runProcess: (command: string) => {
				spawned.push(command);
				return Promise.resolve(0);
			},
			stderr: { write: (chunk: string) => stderr.push(chunk) },
		});

		// then
		expect(exitCode).toBe(1);
		expect(spawned).toEqual([]);
		expect(stderr).toHaveLength(1);
		expect(stderr[0]).toContain("CodeGraph MCP skipped");
		expect(stderr[0]).toContain("Node 26 is unsupported");
		expect(stderr[0]).toContain(CODEGRAPH_UNSAFE_NODE_ENV);
	});
});
