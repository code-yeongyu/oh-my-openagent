import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { createSpawnCommand, spawnProcess } from "../src/lsp/process.js";

const tempDirectories: string[] = [];

afterEach(() => {
	for (const directory of tempDirectories.splice(0)) {
		rmSync(directory, { recursive: true, force: true });
	}
});

function readFirstLine(stream: NodeJS.ReadableStream): Promise<string> {
	return new Promise((resolve, reject) => {
		let buffer = "";

		const cleanup = () => {
			stream.off("data", onData);
			stream.off("error", onError);
		};

		const onData = (chunk: Buffer | string) => {
			buffer += Buffer.isBuffer(chunk) ? chunk.toString("utf8") : chunk;
			const newlineIndex = buffer.indexOf("\n");
			if (newlineIndex === -1) return;
			cleanup();
			resolve(buffer.slice(0, newlineIndex).trim());
		};

		const onError = (error: Error) => {
			cleanup();
			reject(error);
		};

		stream.on("data", onData);
		stream.on("error", onError);
	});
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

function isPidAlive(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch {
		return false;
	}
}

function killPidBestEffort(pid: number): void {
	try {
		process.kill(pid, "SIGKILL");
	} catch {
		// Already exited.
	}
}

describe("createSpawnCommand", () => {
	it("#given windows executable command #when building spawn command #then it avoids shell mode", () => {
		// given
		const command = ["typescript-language-server", "--stdio"];

		// when
		const prepared = createSpawnCommand(command, "win32", "cmd.exe");

		// then
		expect(prepared).toEqual({
			command: "typescript-language-server",
			args: ["--stdio"],
			shell: false,
		});
	});

	it("#given windows cmd shim #when building spawn command #then it uses cmd only for the shim", () => {
		// given
		const command = ["typescript-language-server.cmd", "--stdio"];

		// when
		const prepared = createSpawnCommand(command, "win32", "cmd.exe");

		// then
		expect(prepared).toEqual({
			command: "cmd.exe",
			args: ["/d", "/s", "/c", "typescript-language-server.cmd", "--stdio"],
			shell: false,
		});
	});

	it("#given windows PATH shim #when resolving spawn command #then it executes the shim without shell mode", () => {
		// given
		const binaryDirectory = mkdtempSync(join(tmpdir(), "codex-lsp-bin-"));
		tempDirectories.push(binaryDirectory);
		mkdirSync(binaryDirectory, { recursive: true });
		const shimPath = join(binaryDirectory, "typescript-language-server.cmd");
		writeFileSync(shimPath, "@echo off\n");

		// when
		const prepared = createSpawnCommand(["typescript-language-server", "--stdio"], "win32", "cmd.exe", {
			PATH: binaryDirectory,
			PATHEXT: ".cmd;.exe",
		});

		// then
		expect(prepared).toEqual({
			command: "cmd.exe",
			args: ["/d", "/s", "/c", shimPath, "--stdio"],
			shell: false,
		});
	});
});

describe("spawnProcess", () => {
	it.skipIf(process.platform === "win32")(
		"#given child process tree #when killing spawned wrapper #then descendant process exits too",
		async () => {
			// given
			const directory = mkdtempSync(join(tmpdir(), "lsp-tools-process-tree-"));
			tempDirectories.push(directory);
			const script = [
				"const { spawn } = require('node:child_process')",
				"const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' })",
				"console.error(String(child.pid))",
				"process.on('SIGTERM', () => process.exit(0))",
				"setInterval(() => {}, 1000)",
			].join(";");
			const proc = spawnProcess([process.execPath, "-e", script], { cwd: directory, env: process.env });
			const childPid = Number(await readFirstLine(proc.stderr));

			try {
				// when
				proc.kill("SIGTERM");
				await Promise.race([proc.exited, sleep(2_000)]);
				await sleep(200);

				// then
				expect(Number.isInteger(childPid)).toBe(true);
				expect(isPidAlive(childPid)).toBe(false);
			} finally {
				killPidBestEffort(childPid);
				proc.kill("SIGKILL");
			}
		},
	);
});
