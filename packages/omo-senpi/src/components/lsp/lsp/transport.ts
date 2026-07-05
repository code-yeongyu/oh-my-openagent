import { delimiter } from "node:path";
import {
	createMessageConnection,
	type MessageConnection,
	StreamMessageReader,
	StreamMessageWriter,
} from "vscode-jsonrpc/node.js";

import { REQUEST_TIMEOUT_MS, STOP_HARD_KILL_TIMEOUT_MS, STOP_SIGKILL_GRACE_MS } from "./constants.js";
import { LspConnectionClosedError, LspProcessExitedError, LspRequestTimeoutError } from "./errors.js";
import { type SpawnedProcess, spawnProcess } from "./process.js";
import { getAdditionalPathBases } from "./server-installation.js";
import type { Diagnostic, ResolvedServer } from "./types.js";

export class LspClientTransport {
	protected proc: SpawnedProcess | null = null;
	protected connection: MessageConnection | null = null;
	protected readonly stderrBuffer: string[] = [];
	protected processExited = false;
	protected fakeAlive = false;
	protected readonly diagnosticsStore = new Map<string, Diagnostic[]>();

	constructor(
		protected readonly root: string,
		protected readonly server: ResolvedServer,
	) {}

	pid(): number | undefined {
		return this.proc?.pid;
	}

	command(): string[] {
		return [...this.server.command];
	}

	async start(): Promise<void> {
		if (this.isFakeServer()) {
			this.fakeAlive = true;
			this.processExited = false;
			return;
		}

		const env: Record<string, string | undefined> = {
			...process.env,
			...this.server.env,
		};
		const pathValue = process.platform === "win32" ? (env["PATH"] ?? env["Path"] ?? "") : (env["PATH"] ?? "");
		const spawnPath = [pathValue, ...getAdditionalPathBases(this.root)].filter(Boolean).join(delimiter);
		if (process.platform === "win32" && env["Path"] !== undefined) {
			env["Path"] = spawnPath;
		}
		env["PATH"] = spawnPath;

		this.proc = spawnProcess(this.server.command, {
			cwd: this.root,
			env,
		});
		this.startStderrReading();

		await new Promise<void>((resolve) => setTimeout(resolve, 100));

		if (this.proc.exitCode !== null) {
			const stderr = this.stderrBuffer.join("\n");
			throw new LspProcessExitedError(this.server.id, this.root, this.proc.exitCode, stderr.slice(-2000));
		}

		this.connection = createMessageConnection(
			new StreamMessageReader(this.proc.stdout),
			new StreamMessageWriter(this.proc.stdin),
		);

		this.connection.onNotification(
			"textDocument/publishDiagnostics",
			(params: { uri?: string; diagnostics?: Diagnostic[] }) => {
				if (params.uri) {
					this.diagnosticsStore.set(params.uri, params.diagnostics ?? []);
				}
			},
		);

		this.connection.onRequest("workspace/configuration", (params: { items?: Array<{ section?: string }> }) => {
			const items = params?.items ?? [];
			return items.map((item) => {
				if (item.section === "json") return { validate: { enable: true } };
				return {};
			});
		});

		this.connection.onRequest("client/registerCapability", () => null);
		this.connection.onRequest("window/workDoneProgress/create", () => null);

		this.connection.onClose(() => {
			this.processExited = true;
		});

		this.connection.onError(() => {});

		this.connection.listen();
	}

	protected startStderrReading(): void {
		if (!this.proc) return;
		this.proc.stderr.setEncoding("utf-8");
		this.proc.stderr.on("data", (chunk: string) => {
			this.stderrBuffer.push(chunk);
			if (this.stderrBuffer.length > 100) {
				this.stderrBuffer.shift();
			}
		});
	}

	private isConnectionClosedError(error: unknown): error is Error {
		if (!(error instanceof Error)) {
			return false;
		}
		const code = "code" in error && typeof error.code === "string" ? error.code : undefined;
		return (
			code === "ERR_STREAM_DESTROYED" ||
			/connection closed|connection is disposed|stream was destroyed/i.test(error.message)
		);
	}

	protected sendRequest<T>(method: string): Promise<T>;
	protected sendRequest<T>(method: string, params: unknown): Promise<T>;
	protected async sendRequest<T>(method: string, ...args: [] | [unknown]): Promise<T> {
		if (!this.connection) throw new Error("LSP client not started");

		if (this.processExited || (this.proc && this.proc.exitCode !== null)) {
			const stderrTail = this.stderrBuffer.slice(-10).join("\n");
			throw new LspProcessExitedError(
				this.server.id,
				this.root,
				this.proc?.exitCode ?? null,
				stderrTail || undefined,
			);
		}

		let timeoutHandle: NodeJS.Timeout | null = null;
		const timeoutPromise = new Promise<never>((_, reject) => {
			timeoutHandle = setTimeout(() => {
				const stderrTail = this.stderrBuffer.slice(-5).join("\n");
				reject(new LspRequestTimeoutError(method, stderrTail || undefined));
			}, REQUEST_TIMEOUT_MS);
		});

		try {
			const requestPromise =
				args.length === 0 ? this.connection.sendRequest<T>(method) : this.connection.sendRequest<T>(method, args[0]);
			const result = await Promise.race([requestPromise, timeoutPromise]);
			if (timeoutHandle !== null) clearTimeout(timeoutHandle);
			return result;
		} catch (error) {
			if (timeoutHandle !== null) clearTimeout(timeoutHandle);
			if (this.processExited || (this.proc && this.proc.exitCode !== null)) {
				throw new LspProcessExitedError(
					this.server.id,
					this.root,
					this.proc?.exitCode ?? null,
					this.stderrBuffer.slice(-10).join("\n") || undefined,
				);
			}
			if (this.isConnectionClosedError(error)) {
				throw new LspConnectionClosedError(this.server.id, this.root, error.message);
			}
			throw error;
		}
	}

	protected sendNotification(method: string): Promise<void>;
	protected sendNotification(method: string, params: unknown): Promise<void>;
	protected async sendNotification(method: string, ...args: [] | [unknown]): Promise<void> {
		if (!this.connection) return;
		if (this.processExited || (this.proc && this.proc.exitCode !== null)) return;
		try {
			if (args.length === 0) {
				await this.connection.sendNotification(method);
				return;
			}
			await this.connection.sendNotification(method, args[0]);
		} catch (error) {
			if (this.isConnectionClosedError(error)) {
				throw new LspConnectionClosedError(this.server.id, this.root, error.message);
			}
			throw error;
		}
	}

	isAlive(): boolean {
		return this.fakeAlive || (this.proc !== null && !this.processExited && this.proc.exitCode === null);
	}

	async stop(): Promise<void> {
		if (this.fakeAlive) {
			this.fakeAlive = false;
			this.processExited = true;
			this.diagnosticsStore.clear();
			return;
		}

		if (this.connection) {
			try {
				await this.sendRequest<null>("shutdown");
			} catch {}
			try {
				await this.sendNotification("exit");
			} catch {}
			try {
				this.connection.dispose();
			} catch {}
			this.connection = null;
		}

		const proc = this.proc;
		if (proc) {
			this.proc = null;
			let exitedBeforeTimeout = false;
			try {
				proc.kill();
				let timeoutId: NodeJS.Timeout | undefined;
				const timeoutPromise = new Promise<void>((resolve) => {
					timeoutId = setTimeout(resolve, STOP_HARD_KILL_TIMEOUT_MS);
				});
				await Promise.race([
					proc.exited
						.then(() => {
							exitedBeforeTimeout = true;
						})
						.finally(() => {
							if (timeoutId) clearTimeout(timeoutId);
						}),
					timeoutPromise,
				]);
				if (!exitedBeforeTimeout) {
					try {
						proc.kill("SIGKILL");
						await Promise.race([
							proc.exited,
							new Promise<void>((resolve) => setTimeout(resolve, STOP_SIGKILL_GRACE_MS)),
						]);
					} catch {}
				}
			} catch {}
		}

		this.processExited = true;
		this.diagnosticsStore.clear();
	}

	getStoredDiagnostics(uri: string): Diagnostic[] {
		return this.diagnosticsStore.get(uri) ?? [];
	}

	protected isFakeServer(): boolean {
		return this.server.command[0] === "omo-senpi-fake-ls";
	}

	protected fakeServerPayload(): { diagnostics?: Diagnostic[] } {
		const raw = this.server.command[1];
		if (raw === undefined) return {};
		const parsed: unknown = JSON.parse(raw);
		if (!isRecord(parsed)) return {};
		const diagnostics = parsed["diagnostics"];
		return Array.isArray(diagnostics) ? { diagnostics: diagnostics.filter(isDiagnostic) } : {};
	}
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isPosition(value: unknown): value is { line: number; character: number } {
	return isRecord(value) && typeof value["line"] === "number" && typeof value["character"] === "number";
}

function isRange(value: unknown): value is Diagnostic["range"] {
	return isRecord(value) && isPosition(value["start"]) && isPosition(value["end"]);
}

function isDiagnostic(value: unknown): value is Diagnostic {
	return isRecord(value) && isRange(value["range"]) && typeof value["message"] === "string";
}
