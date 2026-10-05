import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "bun:test";

import { ControlledClock } from "./controlled-clock-test-support.js";
import { LspClient } from "./client.js";
import { LspRequestTimeoutError } from "./errors.js";
import type { ResolvedServer } from "./types.js";

const fakeServer: ResolvedServer = {
	id: "pull-timeout-fake",
	command: ["pull-timeout-fake"],
	extensions: [".ts"],
	priority: 0,
};

class HangingPullClient extends LspClient {
	readonly grantedPullTimeouts: number[] = [];

	constructor(root: string, private readonly clock: ControlledClock) {
		super(root, fakeServer, { diagnosticsFreshnessTimeoutMs: 50, versionlessPublishQuiescenceMs: 5, timerProvider: clock });
		this.setDiagnosticPullSupported(true);
	}

	protected override async sendNotification(): Promise<void> {}

	protected override async sendRequest<T>(
		method: string,
		...args: [] | [unknown] | [unknown, { timeoutMs?: number; signal?: AbortSignal }]
	): Promise<T> {
		if (method !== "textDocument/diagnostic") {
			throw new Error(`unexpected request in hanging-pull fixture: ${method}`);
		}
		const timeoutMs = args[1]?.timeoutMs ?? 0;
		this.grantedPullTimeouts.push(timeoutMs);
		this.clock.advanceBy(timeoutMs);
		throw new LspRequestTimeoutError(method);
	}
}

describe("LspClient diagnostics pull timeout conversion", () => {
	let root: string | null = null;

	afterEach(() => {
		if (root !== null) rmSync(root, { recursive: true, force: true });
		root = null;
	});

	it("#given a pull that exhausts the freshness window #when diagnostics settle #then the timeout converts to freshness_timeout instead of rejecting", async () => {
		root = mkdtempSync(join(tmpdir(), "lsp-pull-timeout-"));
		const source = join(root, "sample.ts");
		writeFileSync(source, "const value = 1;\n", "utf-8");
		const clock = new ControlledClock();
		const client = new HangingPullClient(root, clock);

		const result = await client.diagnostics(source);

		expect(client.grantedPullTimeouts).toEqual([50]);
		expect(result.items).toEqual([]);
		expect(result.transientError?.kind).toBe("freshness_timeout");
	});
});
