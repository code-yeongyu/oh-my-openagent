import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough, Writable } from "node:stream";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { DaemonPaths } from "../src/paths.js";
import { runMcpStdioProxy } from "../src/proxy.js";
import { daemonTestPaths } from "./daemon-path-fixture.js";

const tempDirectories: string[] = [];

afterEach(() => {
	for (const directory of tempDirectories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe("mcp stdio proxy startup watchdog", () => {
	it("#given Codex spawns the proxy but sends no initialize bytes #when startup expires #then the proxy exits instead of blocking the turn forever", async () => {
		const input = new PassThrough();
		const stderrChunks: string[] = [];

		await bounded(
			runMcpStdioProxy({
				input,
				output: collectingOutput([]),
				stderr: collectingOutput(stderrChunks),
				paths: tempPaths(),
				ensure: noSpawn,
				startupTimeoutMs: 20,
			}),
			"proxy did not settle after its MCP startup deadline",
		);

		expect(input.destroyed).toBe(true);
		expect(stderrChunks.join("")).toContain("no MCP request received within 20ms");
	});

	it("#given the parent sends only a partial MCP frame #when startup expires #then incomplete bytes do not disable the watchdog", async () => {
		const input = new PassThrough();
		const stderrChunks: string[] = [];
		const proxy = runMcpStdioProxy({
			input,
			output: collectingOutput([]),
			stderr: collectingOutput(stderrChunks),
			paths: tempPaths(),
			ensure: noSpawn,
			startupTimeoutMs: 20,
		});
		input.write('{"jsonrpc":"2.0"');

		await bounded(proxy, "partial MCP bytes disabled the startup watchdog");

		expect(input.destroyed).toBe(true);
		expect(stderrChunks.join("")).toContain("no MCP request received within 20ms");
	});

	it("#given the diagnostic stream throws #when startup expires #then diagnostic failure cannot prevent proxy shutdown", async () => {
		vi.useFakeTimers();
		const input = new PassThrough();
		const proxy = runMcpStdioProxy({
			input,
			output: collectingOutput([]),
			stderr: new Writable({
				write(): void {
					throw new Error("synthetic diagnostic failure");
				},
			}),
			paths: tempPaths(),
			ensure: noSpawn,
			startupTimeoutMs: 20,
		});

		try {
			await vi.advanceTimersByTimeAsync(20);
			await bounded(proxy, "diagnostic failure prevented proxy shutdown");
			expect(input.destroyed).toBe(true);
		} finally {
			input.destroy();
			vi.useRealTimers();
		}
	});

	it("#given the first MCP request arrives before startup expires #when the proxy becomes idle #then the startup watchdog stays disabled", async () => {
		const input = new PassThrough();
		const outputChunks: string[] = [];
		const responseWritten = deferred();
		const stderrChunks: string[] = [];
		const proxy = runMcpStdioProxy({
			input,
			output: collectingOutput(outputChunks, responseWritten.resolve),
			stderr: collectingOutput(stderrChunks),
			paths: tempPaths(),
			ensure: noSpawn,
			startupTimeoutMs: 20,
		});
		input.write(`${JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} })}\n`);
		await bounded(responseWritten.promise, "proxy did not answer initialize before its startup deadline");

		expect(await settlesWithin(proxy, 40)).toBe(false);
		expect(input.destroyed).toBe(false);
		expect(outputChunks.join("")).toContain('"id":1');
		expect(stderrChunks).toEqual([]);

		input.end();
		await bounded(proxy, "initialized proxy did not settle after input ended");
	});
});

function tempPaths(): DaemonPaths {
	const directory = mkdtempSync(join(tmpdir(), "lsp-daemon-proxy-startup-"));
	tempDirectories.push(directory);
	const paths = daemonTestPaths(directory);
	mkdirSync(paths.dir, { recursive: true });
	writeFileSync(paths.auth, "proxy-startup-token\n", { mode: 0o600 });
	return paths;
}

function collectingOutput(chunks: string[], afterWrite?: () => void): Writable {
	return new Writable({
		write(chunk, _encoding, callback): void {
			chunks.push(chunk.toString());
			afterWrite?.();
			callback();
		},
	});
}

function deferred(): { readonly promise: Promise<void>; resolve(): void } {
	let resolvePromise: (() => void) | undefined;
	const promise = new Promise<void>((resolve) => {
		resolvePromise = resolve;
	});
	return { promise, resolve: () => resolvePromise?.() };
}

async function bounded<T>(promise: Promise<T>, message: string): Promise<T> {
	let timer: ReturnType<typeof setTimeout> | undefined;
	try {
		return await Promise.race([
			promise,
			new Promise<never>((_resolve, reject) => {
				timer = setTimeout(() => reject(new Error(message)), 1_000);
				timer.unref();
			}),
		]);
	} finally {
		if (timer !== undefined) clearTimeout(timer);
	}
}

async function settlesWithin(promise: Promise<unknown>, timeoutMs: number): Promise<boolean> {
	let timer: ReturnType<typeof setTimeout> | undefined;
	try {
		return await Promise.race([
			promise.then(
				() => true,
				() => true,
			),
			new Promise<boolean>((resolve) => {
				timer = setTimeout(() => resolve(false), timeoutMs);
				timer.unref();
			}),
		]);
	} finally {
		if (timer !== undefined) clearTimeout(timer);
	}
}

const noSpawn = (): Promise<void> => Promise.resolve();
