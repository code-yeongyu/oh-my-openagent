import { describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { join } from "node:path";
import { PassThrough, Writable } from "node:stream";
import { fileURLToPath } from "node:url";

import { runCodegraphServe } from "../src/serve.ts";
import {
	frameMcpRequest,
	writeFakeExitingCodegraph,
} from "./mcp-bridge-fixtures.ts";

const componentRoot = realpathSync(
	fileURLToPath(new URL("..", import.meta.url)),
);

describe("runCodegraphServe MCP bridge lifecycle", () => {
	it("#given an exiting Codegraph child and delayed closed parent output #when the final response write fails #then the output error is preserved", async () => {
		const tempRoot = mkdtempSync(
			join(componentRoot, ".tmp-codegraph-exit-output-failure-"),
		);
		const projectRoot = join(tempRoot, "project");
		const fakeCodegraph = join(tempRoot, "codegraph-exiting.cjs");
		const input = new PassThrough();
		const outputError = Object.assign(
			new Error("parent output closed after child exit"),
			{ code: "EPIPE" },
		);
		const writeStarted = Promise.withResolvers<void>();
		const output = new Writable({
			write(_chunk, _encoding, callback) {
				writeStarted.resolve();
				setTimeout(() => callback(outputError), 150);
			},
		});

		try {
			mkdirSync(projectRoot, { recursive: true });
			writeFakeExitingCodegraph(fakeCodegraph);
			const run = runCodegraphServe({
				cwd: tempRoot,
				env: {
					CODEGRAPH_ALLOW_UNSAFE_NODE: "1",
					OMO_CODEGRAPH_BIN: fakeCodegraph,
					OMO_CODEGRAPH_PROJECT_CWD: projectRoot,
					PATH: process.env["PATH"],
				},
				nodeVersion: "22.14.0",
				buildEnv: () => ({}),
				resolve: () => ({
					argsPrefix: [],
					command: fakeCodegraph,
					exists: true,
					source: "env",
				}),
				stderr: { write: () => undefined },
				stdin: input,
				stdout: output,
			});

			input.end(frameMcpRequest({ id: 1, method: "tools/list", params: {} }));

			await writeStarted.promise;
			await expect(run).rejects.toBe(outputError);
		} finally {
			rmSync(tempRoot, { recursive: true, force: true });
		}
	});
});
