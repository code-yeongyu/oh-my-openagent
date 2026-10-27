import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { LspClient } from "./client.js";
import { LspConnectionClosedError, LspProcessExitedError, LspRequestTimeoutError } from "./errors.js";
import type { ResolvedServer } from "./types.js";

/**
 * A tiny document with at least one named symbol, so a `textDocument/documentSymbol`
 * round trip proves the server parsed the file instead of merely answering.
 */
export interface LspProbeFixture {
	readonly fileName: string;
	readonly content: string;
}

/** Fixtures keyed by LSP language id (the values of `EXT_TO_LANG`). */
export const LSP_PROBE_FIXTURES: Readonly<Record<string, LspProbeFixture>> = {
	typescript: { fileName: "probe.ts", content: "export function probe(value: number): number {\n\treturn value + 1;\n}\n" },
	typescriptreact: {
		fileName: "probe.tsx",
		content: "export function Probe(): null {\n\treturn null;\n}\n",
	},
	javascript: { fileName: "probe.js", content: "export function probe(value) {\n\treturn value + 1;\n}\n" },
	javascriptreact: { fileName: "probe.jsx", content: "export function Probe() {\n\treturn null;\n}\n" },
	shellscript: { fileName: "probe.sh", content: "#!/usr/bin/env bash\nprobe() {\n\techo ok\n}\nprobe\n" },
	yaml: { fileName: "probe.yaml", content: "probe:\n  value: 1\n" },
	json: { fileName: "probe.json", content: '{\n\t"probe": 1\n}\n' },
	jsonc: { fileName: "probe.jsonc", content: '{\n\t// probe\n\t"probe": 1\n}\n' },
	markdown: { fileName: "probe.md", content: "# Probe\n\nText.\n" },
	dockerfile: { fileName: "Dockerfile", content: "FROM scratch\nCOPY probe /probe\n" },
	python: { fileName: "probe.py", content: "def probe(value: int) -> int:\n    return value + 1\n" },
};

export type LspProbeStage = "spawn" | "initialize" | "request";

export type LspProbeResult =
	| {
			readonly status: "ok";
			readonly durationMs: number;
			readonly symbols: number;
			/** Diagnostics for the fixture, or null when the server published none within the short window. */
			readonly diagnostics: number | null;
	  }
	| {
			readonly status: "startup_failed" | "timeout" | "request_failed";
			readonly stage: LspProbeStage;
			readonly durationMs: number;
			readonly detail: string;
	  };

export interface ProbeLspServerOptions {
	readonly initializeTimeoutMs?: number;
	readonly requestTimeoutMs?: number;
	readonly diagnosticsWindowMs?: number;
	/** How long an empty documentSymbol answer is retried before it counts as "not parsing". */
	readonly symbolsWindowMs?: number;
	/** Directory the throwaway probe workspace is created in; defaults to the OS temp directory. */
	readonly tempRoot?: string;
}

const DEFAULT_INITIALIZE_TIMEOUT_MS = 30_000;
const DEFAULT_REQUEST_TIMEOUT_MS = 20_000;
const DEFAULT_DIAGNOSTICS_WINDOW_MS = 1_500;
const DEFAULT_SYMBOLS_WINDOW_MS = 3_000;
const SYMBOLS_RETRY_MS = 150;
const MAX_DETAIL_LENGTH = 400;
const KILL_GRACE_MS = 2_000;

/**
 * Starts `server` in a throwaway workspace holding only `fixture`, runs a bounded
 * `initialize` and a `textDocument/documentSymbol` round trip, then shuts it down.
 *
 * This is the functional half of a dependency check: a resolved binary only proves a file
 * exists, while this proves the server starts, speaks LSP and parses the language. It never
 * touches the user's project and never installs anything.
 */
export async function probeLspServer(
	server: ResolvedServer,
	fixture: LspProbeFixture,
	options: ProbeLspServerOptions = {},
): Promise<LspProbeResult> {
	const startedAt = performance.now();
	const elapsed = (): number => Math.round(performance.now() - startedAt);
	// The document state opens files by real path, so a workspace under a symlink (macOS's /var ->
	// /private/var temp dir) would have documentSymbol ask about a URI the server never opened.
	const workspace = realpathSync(mkdtempSync(join(options.tempRoot ?? tmpdir(), "omo-lsp-probe-")));
	const filePath = join(workspace, fixture.fileName);
	writeFileSync(filePath, fixture.content, "utf-8");

	const client = new ProbeClient(workspace, server, {
		initializeTimeoutMs: options.initializeTimeoutMs ?? DEFAULT_INITIALIZE_TIMEOUT_MS,
		requestTimeoutMs: options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS,
		diagnosticsFreshnessTimeoutMs: options.diagnosticsWindowMs ?? DEFAULT_DIAGNOSTICS_WINDOW_MS,
	});

	let stage: LspProbeStage = "spawn";
	let failed = false;
	try {
		await client.start();
		stage = "initialize";
		await client.untilExit(client.initialize());
		stage = "request";
		const symbolCount = await countSymbols(client, filePath, options.symbolsWindowMs ?? DEFAULT_SYMBOLS_WINDOW_MS);
		if (symbolCount === 0) {
			return {
				status: "request_failed",
				stage,
				durationMs: elapsed(),
				detail: `documentSymbol answered with no symbols for ${fixture.fileName}, which declares one; the server is not parsing the language.`,
			};
		}
		const diagnostics = await countDiagnostics(client, filePath);
		return { status: "ok", durationMs: elapsed(), symbols: symbolCount, diagnostics };
	} catch (error) {
		failed = true;
		return { status: classifyFailure(error, stage), stage, durationMs: elapsed(), detail: describeError(error) };
	} finally {
		await stopClient(client, failed);
		rmSync(workspace, { recursive: true, force: true });
	}
}

/**
 * Some servers parse a document asynchronously after `didOpen` (bash-language-server answers
 * `[]` for its first ~300ms), so an empty answer is retried until the window closes.
 */
async function countSymbols(client: ProbeClient, filePath: string, windowMs: number): Promise<number> {
	const deadline = performance.now() + windowMs;
	for (;;) {
		const symbols = await client.untilExit(client.documentSymbols(filePath));
		const count = Array.isArray(symbols) ? symbols.length : 0;
		if (count > 0 || performance.now() >= deadline) return count;
		await new Promise((resolve) => setTimeout(resolve, SYMBOLS_RETRY_MS));
	}
}

async function countDiagnostics(client: LspClient, filePath: string): Promise<number | null> {
	try {
		const result = await client.diagnostics(filePath);
		return result.transientError === undefined ? result.items.length : null;
	} catch (error) {
		if (error instanceof Error) return null;
		throw error;
	}
}

function classifyFailure(error: unknown, stage: LspProbeStage): "startup_failed" | "timeout" | "request_failed" {
	if (error instanceof LspRequestTimeoutError) return "timeout";
	if (error instanceof LspProcessExitedError || error instanceof LspConnectionClosedError) return "startup_failed";
	return stage === "request" ? "request_failed" : "startup_failed";
}

/** First line of the error plus a short stderr tail; never the environment or the command line. */
function describeError(error: unknown): string {
	const message = error instanceof Error ? error.message : String(error);
	const collapsed = message.replace(/\s+/g, " ").trim();
	return collapsed.length > MAX_DETAIL_LENGTH ? `${collapsed.slice(0, MAX_DETAIL_LENGTH)}...` : collapsed;
}

/**
 * Pending JSON-RPC requests are not rejected when the server process dies, so a server that
 * crashes on start would otherwise surface only after the full initialize timeout.
 */
class ProbeClient extends LspClient {
	async untilExit<T>(work: Promise<T>): Promise<T> {
		const proc = this.proc;
		if (proc === null) return work;
		const outcome = await Promise.race([
			work.then((value) => ({ kind: "done" as const, value })),
			proc.exited.then((exitCode) => ({ kind: "exited" as const, exitCode })),
		]);
		if (outcome.kind === "done") return outcome.value;
		const stderrTail = this.stderrBuffer.slice(-5).join("\n");
		throw new LspProcessExitedError(this.server.id, this.root, outcome.exitCode, stderrTail || undefined);
	}

	/**
	 * A failed probe may leave a server that ignores `shutdown`. Killing it (its whole process
	 * group) and marking it exited lets `stop()` skip the shutdown request instead of waiting
	 * out the request timeout.
	 */
	async killAndWait(graceMs: number): Promise<void> {
		const proc = this.proc;
		if (proc === null) return;
		proc.kill("SIGKILL");
		let timer: ReturnType<typeof setTimeout> | undefined;
		await Promise.race([proc.exited, new Promise((resolve) => (timer = setTimeout(resolve, graceMs)))]);
		clearTimeout(timer);
		this.processExited = true;
	}
}

async function stopClient(client: ProbeClient, failed: boolean): Promise<void> {
	if (failed) await client.killAndWait(KILL_GRACE_MS);
	try {
		await client.stop();
	} catch (error) {
		if (!(error instanceof Error)) throw error;
	}
}
