import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "bun:test";

import { aggregateDiagnosticsForDirectory } from "./directory-diagnostics.js";
import { LspClient } from "./client.js";
import { LspManager } from "./manager.js";
import type { Diagnostic, ResolvedServer } from "./types.js";

describe("directory diagnostics", () => {
	it("#given multiple files and one per-file failure #when directory diagnostics run #then work stays bounded and file failures stay structured", async () => {
		const workspace = mkdtempSync(join(tmpdir(), "lsp-directory-diag-"));
		const active: string[] = [];
		let maxActive = 0;
		const diagnosticsByFile = new Map<string, Diagnostic[] | Error>([
			[join(workspace, "a.ts"), [diagnostic("a")]],
			[join(workspace, "b.ts"), new Error("b failed")],
			[join(workspace, "c.ts"), [diagnostic("c")]],
			[join(workspace, "d.ts"), [diagnostic("d")]],
			[join(workspace, "e.ts"), [diagnostic("e")]],
		]);
		const client = {
			async diagnostics(filePath: string) {
				active.push(filePath);
				maxActive = Math.max(maxActive, active.length);
				await Promise.resolve();
				active.splice(active.indexOf(filePath), 1);
				const entry = diagnosticsByFile.get(filePath);
				if (entry instanceof Error) throw entry;
				return { items: entry ?? [] };
			},
		} as Pick<LspClient, "diagnostics"> as LspClient;
		const server: ResolvedServer = { id: "typescript", command: ["typescript-language-server"], extensions: [".ts"], priority: 1 };
		const manager = {
			async getClient() {
				return client;
			},
			releaseClient() {},
		};

		try {
			const result = await aggregateDiagnosticsForDirectory(workspace, ".ts", "all", 4, {
				manager: manager as never,
				listFiles: () => [...diagnosticsByFile.keys()],
				workspaceRoot: workspace,
				server,
				maxConcurrency: 2,
			});

			expect(maxActive).toBeLessThanOrEqual(2);
			expect(result.fileFailures).toEqual([{ file: join(workspace, "b.ts"), error: "b failed" }]);
			expect(result.totalDiagnostics).toBe(3);
			expect(result.output).toContain("File processing errors:");
		} finally {
			rmSync(workspace, { recursive: true, force: true });
		}
	});

	it("#given directory diagnostics are aborted after one file #when the worker loops #then no later file is scheduled", async () => {
		const workspace = mkdtempSync(join(tmpdir(), "lsp-directory-diag-cancel-"));
		const controller = new AbortController();
		const visited: string[] = [];
		const firstFile = join(workspace, "a.ts");
		const files = [firstFile, join(workspace, "b.ts"), join(workspace, "c.ts")];
		const client = {
			async diagnostics(filePath: string) {
				visited.push(filePath);
				controller.abort();
				return { items: [] };
			},
		} as Pick<LspClient, "diagnostics"> as LspClient;
		const server: ResolvedServer = { id: "typescript", command: ["typescript-language-server"], extensions: [".ts"], priority: 1 };
		const manager = {
			async getClient() {
				return client;
			},
			releaseClient() {},
		};

		try {
			const result = await aggregateDiagnosticsForDirectory(workspace, ".ts", "all", 3, {
				manager: manager as never,
				listFiles: () => files,
				workspaceRoot: workspace,
				server,
				maxConcurrency: 1,
				signal: controller.signal,
			});

			expect(result.totalDiagnostics).toBe(0);
			expect(visited).toEqual([firstFile]);
		} finally {
			rmSync(workspace, { recursive: true, force: true });
		}
	});

	it("#given cold client acquisition is pending #when directory diagnostics are aborted #then acquisition settles and cleans up before startup releases", async () => {
		const workspace = mkdtempSync(join(tmpdir(), "lsp-directory-diag-cold-cancel-"));
		const controller = new AbortController();
		const startupStarted = deferred();
		const startupRelease = deferred();
		const server: ResolvedServer = {
			id: "typescript",
			command: ["typescript-language-server"],
			extensions: [".ts"],
			priority: 1,
		};
		const client = new PendingStartLspClient({
			root: workspace,
			server,
			startupStarted,
			startupRelease,
		});
		const manager = new LspManager({
			clientFactory: () => client,
			reaperIntervalMs: 60_000,
		});
		const aggregation = aggregateDiagnosticsForDirectory(workspace, ".ts", "all", 1, {
			manager,
			listFiles: () => [join(workspace, "a.ts")],
			workspaceRoot: workspace,
			server,
			signal: controller.signal,
		});

		try {
			await startupStarted.promise;
			controller.abort();

			const settledBeforeStartupRelease = await settlesWithin(aggregation, 100);

			expect(settledBeforeStartupRelease).toBe(true);
			await expect(aggregation).rejects.toHaveProperty("name", "AbortError");
			expect(manager.clientCount()).toBe(0);
			expect(client.stopCallCount).toBe(1);
		} finally {
			startupRelease.resolve();
			await aggregation.catch(() => undefined);
			await manager.stopAll();
			rmSync(workspace, { recursive: true, force: true });
		}
	});
});

class PendingStartLspClient extends LspClient {
	stopCallCount = 0;
	private readonly startupStarted: Deferred;
	private readonly startupRelease: Deferred;

	constructor(options: PendingStartLspClientOptions) {
		super(options.root, options.server);
		this.startupStarted = options.startupStarted;
		this.startupRelease = options.startupRelease;
	}

	override async start(): Promise<void> {
		this.startupStarted.resolve();
		await this.startupRelease.promise;
	}

	override async initialize(): Promise<void> {}

	override async stop(): Promise<void> {
		this.stopCallCount += 1;
	}

	override isAlive(): boolean {
		return true;
	}

	override async diagnostics(): Promise<{ readonly items: Diagnostic[] }> {
		return { items: [] };
	}
}

interface PendingStartLspClientOptions {
	readonly root: string;
	readonly server: ResolvedServer;
	readonly startupStarted: Deferred;
	readonly startupRelease: Deferred;
}

interface Deferred {
	readonly promise: Promise<void>;
	resolve(): void;
}

function deferred(): Deferred {
	let resolvePromise: (() => void) | undefined;
	const promise = new Promise<void>((resolve) => {
		resolvePromise = resolve;
	});
	return { promise, resolve: () => resolvePromise?.() };
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

function diagnostic(message: string): Diagnostic {
	return {
		range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } },
		message,
	};
}
