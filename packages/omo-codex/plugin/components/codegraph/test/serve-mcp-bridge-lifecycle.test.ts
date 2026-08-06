import { describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { join } from "node:path";
import { PassThrough, Writable } from "node:stream";
import { fileURLToPath } from "node:url";

import { isProcessAlive } from "../../../../../mcp-stdio-core/src/index.ts";
import { runCodegraphServe } from "../src/serve.ts";
import {
	frameMcpRequest,
	writeFakeExitingCodegraph,
	writeFakeHeldOpenCodegraph,
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

	it("#given a held-open Codegraph child and a dead parent #when the bridge watchdog polls #then the child is terminated and the bridge settles through the child-exit path", async () => {
		// given
		const tempRoot = mkdtempSync(
			join(componentRoot, ".tmp-codegraph-orphan-"),
		);
		const projectRoot = join(tempRoot, "project");
		const fakeCodegraph = join(tempRoot, "codegraph-held-open.cjs");
		const childPidFile = join(tempRoot, "child.pid");
		// Client stdio is held open and never sees EOF, so the parent-liveness
		// watchdog is the only settle path. The probe reports the parent alive
		// until the child has started, making the poll fire deterministically.
		const input = new PassThrough();
		const output = new PassThrough();
		output.resume();
		let childPid: number | undefined;

		try {
			mkdirSync(projectRoot, { recursive: true });
			writeFakeHeldOpenCodegraph(fakeCodegraph);
			const run = runCodegraphServe({
				cwd: tempRoot,
				env: {
					CODEGRAPH_ALLOW_UNSAFE_NODE: "1",
					CODEGRAPH_FAKE_LOG: childPidFile,
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
				parentWatchdog: {
					pollIntervalMs: 10,
					probeAlive: () => !existsSync(childPidFile),
				},
			});

			// when
			const exitCode = await run;

			// then
			expect(exitCode).not.toBe(0);
			childPid = Number(readFileSync(childPidFile, "utf8"));
			expect(isProcessAlive(childPid)).toBe(false);
		} finally {
			if (childPid !== undefined && isProcessAlive(childPid)) {
				process.kill(childPid, "SIGKILL");
			}
			input.destroy();
			output.destroy();
			rmSync(tempRoot, { recursive: true, force: true });
		}
	});
});
