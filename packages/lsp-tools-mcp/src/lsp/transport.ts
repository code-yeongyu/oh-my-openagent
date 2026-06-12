import { reportBestEffortCleanupError } from "./cleanup-errors.js";
import { INIT_TIMEOUT_MS, REQUEST_TIMEOUT_MS, STOP_HARD_KILL_TIMEOUT_MS, STOP_SIGKILL_GRACE_MS } from "./constants.js";
import { LspConnectionClosedError, LspProcessExitedError, LspRequestTimeoutError } from "./errors.js";
import { JsonRpcConnection } from "./json-rpc-connection.js";
import { type SpawnedProcess, spawnProcess } from "./process.js";
import type { Diagnostic, ResolvedServer } from "./types.js";

interface ConfigurationItem {
	section?: string;
}

interface DiagnosticsParams {
	uri: string;
	diagnostics: Diagnostic[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseConfigurationItems(params: unknown): ConfigurationItem[] {
	if (!isRecord(params) || !Array.isArray(params["items"])) return [];
	const items: ConfigurationItem[] = [];
	for (const item of params["items"]) {
		if (!isRecord(item)) continue;
		const section = item["section"];
		items.push(section === undefined || typeof section !== "string" ? {} : { section });
	}
	return items;
}

function parseDiagnosticsParams(params: unknown): DiagnosticsParams | null {
	if (!isRecord(params) || typeof params["uri"] !== "string") return null;
	const diagnostics = Array.isArray(params["diagnostics"]) ? params["diagnostics"].filter(isDiagnostic) : [];
	return { uri: params["uri"], diagnostics };
}

export interface LspClientTimeoutOptions {
	requestTimeoutMs?: number;
	initializeTimeoutMs?: number;
}

export class LspClientTransport {
	protected proc: SpawnedProcess | null = null;
	protected connection: JsonRpcConnection | null = null;
	protected readonly stderrBuffer: string[] = [];
	protected processExited = false;
	protected readonly diagnosticsStore = new Map<string, Diagnostic[]>();
	protected readonly requestTimeoutMs: number;
	protected readonly initializeTimeoutMs: number;

	constructor(
		protected readonly root: string,
		protected readonly server: ResolvedServer,
		timeouts: LspClientTimeoutOptions = {},
	) {
		this.requestTimeoutMs = timeouts.requestTimeoutMs ?? REQUEST_TIMEOUT_MS;
		this.initializeTimeoutMs = timeouts.initializeTimeoutMs ?? INIT_TIMEOUT_MS;
	}

	pid(): number | undefined {
		return this.proc?.pid;
	}

	command(): string[] {
		return [...this.server.command];
	}

	async start(): Promise<void> {
		const env = createLspSpawnEnv(this.root, {
			...process.env,
			...this.server.env,
		});

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

		this.connection = new JsonRpcConnection(this.proc.stdout, this.proc.stdin);

		this.connection.onNotification("textDocument/publishDiagnostics", (params) => {
			const diagnosticsParams = parseDiagnosticsParams(params);
			if (diagnosticsParams?.uri) {
				this.diagnosticsStore.set(diagnosticsParams.uri, diagnosticsParams.diagnostics);
			}
		});

		this.connection.onRequest("workspace/configuration", (params) => {
			const items = parseConfigurationItems(params);
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

		this.connection.onError((error) => {
			reportBestEffortCleanupError("connection error notification", error);
		});

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
	protected sendRequest<T>(method: string, params: unknown, options: { timeoutMs?: number }): Promise<T>;
	protected async sendRequest<T>(
		method: string,
		...args: [] | [unknown] | [unknown, { timeoutMs?: number }]
	): Promise<T> {
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

		const timeoutMs = args[1]?.timeoutMs ?? this.requestTimeoutMs;
		let timeoutHandle: NodeJS.Timeout | null = null;
		const timeoutPromise = new Promise<never>((_, reject) => {
			timeoutHandle = setTimeout(() => {
				const stderrTail = this.stderrBuffer.slice(-5).join("\n");
				reject(new LspRequestTimeoutError(method, stderrTail || undefined));
			}, timeoutMs);
		});

		try {
			const requestPromise =
				args.length === 0
					? this.connection.sendRequest<T>(method)
					: this.connection.sendRequest<T>(method, args[0]);
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
			} else {
				await this.connection.sendNotification(method, args[0]);
			}
		} catch (error) {
			if (this.isConnectionClosedError(error)) {
				throw new LspConnectionClosedError(this.server.id, this.root, error.message);
			}
			throw error;
		}
	}

	isAlive(): boolean {
		return this.proc !== null && !this.processExited && this.proc.exitCode === null;
	}

	async stop(): Promise<void> {
		if (this.connection) {
			try {
				await this.sendRequest<null>("shutdown");
			} catch (error) {
				reportBestEffortCleanupError("shutdown request", error);
			}
			try {
				await this.sendNotification("exit");
			} catch (error) {
				reportBestEffortCleanupError("exit notification", error);
			}
			try {
				this.connection.dispose();
			} catch (error) {
				reportBestEffortCleanupError("connection dispose", error);
			}
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
					} catch (error) {
						reportBestEffortCleanupError("hard process kill", error);
					}
				}
			} catch (error) {
				reportBestEffortCleanupError("process stop", error);
			}
		}

		this.processExited = true;
		this.diagnosticsStore.clear();
	}

	getStoredDiagnostics(uri: string): Diagnostic[] {
		return this.diagnosticsStore.get(uri) ?? [];
	}
}

export function createLspSpawnEnv(
	_root: string,
	input: Record<string, string | undefined>,
): Record<string, string | undefined> {
	return { ...input };
}

function isDiagnostic(value: unknown): value is Diagnostic {
	return isRecord(value) && isRange(value["range"]) && typeof value["message"] === "string";
}

function isRange(value: unknown): value is Diagnostic["range"] {
	return isRecord(value) && isPosition(value["start"]) && isPosition(value["end"]);
}

function isPosition(value: unknown): value is Diagnostic["range"]["start"] {
	return isRecord(value) && typeof value["line"] === "number" && typeof value["character"] === "number";
}
