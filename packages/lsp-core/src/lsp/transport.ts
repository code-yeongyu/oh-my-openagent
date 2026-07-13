import { reportBestEffortCleanupError } from "./cleanup-errors.js";
import { INIT_TIMEOUT_MS, REQUEST_TIMEOUT_MS, STOP_HARD_KILL_TIMEOUT_MS, STOP_SIGKILL_GRACE_MS } from "./constants.js";
import { LspConnectionClosedError, LspProcessExitedError, LspRequestTimeoutError } from "./errors.js";
import { JsonRpcConnection } from "./json-rpc-connection.js";
import { type SpawnedProcess, spawnProcess } from "./process.js";
import { createLspSpawnEnv, parseConfigurationItems, parseDiagnosticsParams } from "./transport-protocol.js";
import type { Diagnostic, ResolvedServer } from "./types.js";
import type { WorkspaceApplyEditResponse } from "./workspace-mutation-controller.js";

export { createLspSpawnEnv } from "./transport-protocol.js";

export interface LspClientTimeoutOptions {
	requestTimeoutMs?: number;
	initializeTimeoutMs?: number;
}

type WorkspaceApplyEditHandler = (params: unknown) => Promise<WorkspaceApplyEditResponse>;

class LspClientNotStartedError extends Error {
	override readonly name = "LspClientNotStartedError";

	constructor(
		readonly serverId: string,
		readonly root: string,
	) {
		super("LSP client not started");
	}
}

export class LspClientTransport {
	protected proc: SpawnedProcess | null = null;
	protected connection: JsonRpcConnection | null = null;
	protected readonly stderrBuffer: string[] = [];
	protected processExited = false;
	protected readonly diagnosticsStore = new Map<string, Diagnostic[]>();
	protected readonly requestTimeoutMs: number;
	protected readonly initializeTimeoutMs: number;
	private workspaceApplyEditHandler: WorkspaceApplyEditHandler | null = null;
	private diagnosticPullSupported = false;

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

	protected setWorkspaceApplyEditHandler(handler: WorkspaceApplyEditHandler): void {
		this.workspaceApplyEditHandler = handler;
	}

	protected hasWorkspaceApplyEditHandler(): boolean {
		return this.workspaceApplyEditHandler !== null;
	}

	protected setDiagnosticPullSupported(supported: boolean): void {
		this.diagnosticPullSupported = supported;
	}

	protected isDiagnosticPullSupported(): boolean {
		return this.diagnosticPullSupported;
	}

	protected handlePublishDiagnostics(params: {
		readonly uri: string;
		readonly diagnostics: readonly Diagnostic[];
		readonly version?: number;
	}): void {
		this.diagnosticsStore.set(params.uri, [...params.diagnostics]);
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

		if (this.proc.exitCode !== null) {
			const stderr = this.stderrBuffer.join("\n");
			throw new LspProcessExitedError(this.server.id, this.root, this.proc.exitCode, stderr.slice(-2000));
		}

		this.connection = new JsonRpcConnection(this.proc.stdout, this.proc.stdin);

		this.connection.onNotification("textDocument/publishDiagnostics", (params) => {
			const diagnosticsParams = parseDiagnosticsParams(params);
			if (diagnosticsParams?.uri) {
				this.handlePublishDiagnostics(diagnosticsParams);
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
		if (this.workspaceApplyEditHandler) {
			this.connection.onRequest("workspace/applyEdit", this.workspaceApplyEditHandler);
		}

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
	protected sendRequest<T>(
		method: string,
		params: unknown,
		options: { timeoutMs?: number; signal?: AbortSignal },
	): Promise<T>;
	protected async sendRequest<T>(
		method: string,
		...args: [] | [unknown] | [unknown, { timeoutMs?: number; signal?: AbortSignal }]
	): Promise<T> {
		if (!this.connection) throw new LspClientNotStartedError(this.server.id, this.root);

		if (this.processExited || (this.proc && this.proc.exitCode !== null)) {
			const stderrTail = this.stderrBuffer.slice(-10).join("\n");
			throw new LspProcessExitedError(
				this.server.id,
				this.root,
				this.proc?.exitCode ?? null,
				stderrTail || undefined,
			);
		}

		const options = args[1];
		const timeoutMs = options?.timeoutMs ?? this.requestTimeoutMs;
		const timeoutController = new AbortController();
		const timeoutHandle = setTimeout(() => {
			const stderrTail = this.stderrBuffer.slice(-5).join("\n");
			timeoutController.abort(new LspRequestTimeoutError(method, stderrTail || undefined));
		}, timeoutMs);
		const combinedSignal = combineAbortSignals(options?.signal, timeoutController.signal);

		try {
			const result =
				args.length === 0
					? await this.connection.sendRequest<T>(method, undefined, { signal: combinedSignal.signal })
					: await this.connection.sendRequest<T>(method, args[0], { signal: combinedSignal.signal });
			return result;
		} catch (error) {
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
		} finally {
			clearTimeout(timeoutHandle);
			combinedSignal.dispose();
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
				reportBestEffortCleanupError("shutdown request", error instanceof Error ? error : String(error));
			}
			try {
				await this.sendNotification("exit");
			} catch (error) {
				reportBestEffortCleanupError("exit notification", error instanceof Error ? error : String(error));
			}
			try {
				this.connection.dispose();
			} catch (error) {
				reportBestEffortCleanupError("connection dispose", error instanceof Error ? error : String(error));
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
						reportBestEffortCleanupError("hard process kill", error instanceof Error ? error : String(error));
					}
				}
			} catch (error) {
				reportBestEffortCleanupError("process stop", error instanceof Error ? error : String(error));
			}
		}

		this.processExited = true;
		this.diagnosticsStore.clear();
	}

	getStoredDiagnostics(uri: string): Diagnostic[] {
		return this.diagnosticsStore.get(uri) ?? [];
	}
}

function combineAbortSignals(
	primary: AbortSignal | undefined,
	secondary: AbortSignal,
): { readonly signal: AbortSignal; readonly dispose: () => void } {
	const controller = new AbortController();
	const abortFrom = (signal: AbortSignal): void => {
		if (!controller.signal.aborted) controller.abort(signal.reason);
	};
	const onPrimaryAbort = (): void => {
		if (primary) abortFrom(primary);
	};
	const onSecondaryAbort = (): void => abortFrom(secondary);

	if (primary?.aborted) abortFrom(primary);
	else primary?.addEventListener("abort", onPrimaryAbort, { once: true });
	if (secondary.aborted) abortFrom(secondary);
	else secondary.addEventListener("abort", onSecondaryAbort, { once: true });

	return {
		signal: controller.signal,
		dispose: () => {
			primary?.removeEventListener("abort", onPrimaryAbort);
			secondary.removeEventListener("abort", onSecondaryAbort);
		},
	};
}
