import { describe, expect, it } from "bun:test";
import { PassThrough } from "node:stream";

import { runCodegraphServe } from "../src/serve.ts";

describe("runCodegraphServe MCP unavailable facade", () => {
	it("#given CodeGraph is unavailable #when an MCP client initializes #then it answers with an empty-tool facade", async () => {
		// given
		const input = new PassThrough();
		const output = new PassThrough();
		const stderr: string[] = [];
		let stdout = "";
		output.on("data", (chunk: Buffer) => {
			stdout += chunk.toString("utf8");
		});

		const run = runCodegraphServe({
			config: { codegraph: { auto_provision: false, enabled: true }, sources: [], warnings: [] },
			env: { PATH: "/bin" },
			buildEnv: () => ({}),
			resolve: () => ({ argsPrefix: [], command: "codegraph", exists: false, source: "path" }),
			stderr: { write: (chunk: string) => stderr.push(chunk) },
			stdin: input,
			stdout: output,
		});

		// when
		input.end(frameMcpRequest({
			id: 1,
			method: "initialize",
			params: {
				capabilities: {},
				clientInfo: { name: "ulw-red", version: "0.0.0" },
				protocolVersion: "2025-06-18",
			},
		}));
		const exitCode = await run;

		// then
		expect(exitCode).toBe(0);
		expect(stderr).toEqual([
			"CodeGraph MCP skipped: codegraph binary not found. Install CodeGraph or set OMO_CODEGRAPH_BIN.\n",
		]);
		expect(parseFirstJsonRpcBody(stdout)).toEqual({
			id: 1,
			jsonrpc: "2.0",
			result: {
				capabilities: { tools: { listChanged: false } },
				protocolVersion: "2025-06-18",
				serverInfo: { name: "codegraph", version: "1.0.1" },
			},
		});
	});
});

function frameMcpRequest(request: {
	readonly id: number;
	readonly method: string;
	readonly params: Record<string, unknown>;
}): string {
	const body = JSON.stringify({ jsonrpc: "2.0", ...request });
	return `Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`;
}

function parseFirstJsonRpcBody(transcript: string): unknown {
	const [, body = ""] = transcript.split("\r\n\r\n", 2);
	return JSON.parse(body);
}
