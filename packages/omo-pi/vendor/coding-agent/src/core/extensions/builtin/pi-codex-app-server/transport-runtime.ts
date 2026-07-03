import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { PiCodexAppServerRuntimeError } from "./runtime-errors.ts";
import { openWebSocketConnection, type PiCodexAppServerWebSocketDependencies } from "./websocket-transport.ts";

export type { PiCodexAppServerWebSocketLike } from "./websocket-transport.ts";

export type PiCodexAppServerTransportMode = "stdio" | "websocket" | "unix";

export interface PiCodexAppServerRuntimeFlags {
	readonly enabled: boolean;
	readonly mode: PiCodexAppServerTransportMode;
	readonly appServerCommand: string;
	readonly appServerArgs: readonly string[];
	readonly appServerUrl: string;
	readonly appServerSocketPath?: string;
	readonly connectTimeoutMs: number;
}

export type PiCodexAppServerRuntimeStatus =
	| { readonly kind: "stopped" }
	| { readonly kind: "starting"; readonly mode: PiCodexAppServerTransportMode }
	| { readonly kind: "running"; readonly mode: PiCodexAppServerTransportMode }
	| { readonly kind: "failed"; readonly mode: PiCodexAppServerTransportMode; readonly message: string };

export interface PiCodexAppServerRuntimeController {
	start(flags: PiCodexAppServerRuntimeFlags): Promise<PiCodexAppServerRuntimeStatus>;
	stop(): Promise<PiCodexAppServerRuntimeStatus>;
	getStatus(): PiCodexAppServerRuntimeStatus;
}

export type PiCodexAppServerRuntime = PiCodexAppServerRuntimeController;

export type PiCodexAppServerRuntimeDependencies = PiCodexAppServerWebSocketDependencies;

interface RuntimeConnection {
	readonly mode: PiCodexAppServerTransportMode;
	close(): Promise<void>;
	onFailure(handler: (message: string) => void): void;
}

interface ChildProcessConnectionOptions {
	readonly mode: PiCodexAppServerTransportMode;
	readonly command: string;
	readonly args: readonly string[];
	readonly connectTimeoutMs: number;
}

export function createPiCodexAppServerRuntime(
	dependencies: PiCodexAppServerRuntimeDependencies = {},
): PiCodexAppServerRuntime {
	return new DefaultPiCodexAppServerRuntime(dependencies);
}

class DefaultPiCodexAppServerRuntime implements PiCodexAppServerRuntime {
	private status: PiCodexAppServerRuntimeStatus = { kind: "stopped" };
	private connection: RuntimeConnection | undefined;
	private readonly dependencies: PiCodexAppServerRuntimeDependencies;

	constructor(dependencies: PiCodexAppServerRuntimeDependencies) {
		this.dependencies = dependencies;
	}

	async start(flags: PiCodexAppServerRuntimeFlags): Promise<PiCodexAppServerRuntimeStatus> {
		await this.stop();
		if (!flags.enabled) {
			this.status = { kind: "stopped" };
			return this.status;
		}

		this.status = { kind: "starting", mode: flags.mode };
		try {
			const connection = await openConnection(flags, this.dependencies);
			connection.onFailure((message) => {
				if (this.connection !== connection) return;
				this.connection = undefined;
				this.status = { kind: "failed", mode: connection.mode, message };
			});
			this.connection = connection;
			this.status = { kind: "running", mode: flags.mode };
			return this.status;
		} catch (error) {
			this.connection = undefined;
			this.status = { kind: "failed", mode: flags.mode, message: formatError(error) };
			return this.status;
		}
	}

	async stop(): Promise<PiCodexAppServerRuntimeStatus> {
		const activeConnection = this.connection;
		this.connection = undefined;
		if (activeConnection) {
			await activeConnection.close();
		}
		this.status = { kind: "stopped" };
		return this.status;
	}

	getStatus(): PiCodexAppServerRuntimeStatus {
		return this.status;
	}
}

async function openConnection(
	flags: PiCodexAppServerRuntimeFlags,
	dependencies: PiCodexAppServerRuntimeDependencies,
): Promise<RuntimeConnection> {
	switch (flags.mode) {
		case "stdio":
			return openChildProcessConnection({
				mode: flags.mode,
				command: flags.appServerCommand,
				args: flags.appServerArgs,
				connectTimeoutMs: flags.connectTimeoutMs,
			});
		case "unix":
			return openChildProcessConnection({
				mode: flags.mode,
				command: flags.appServerCommand,
				args: resolveUnixProxyArgs(flags),
				connectTimeoutMs: flags.connectTimeoutMs,
			});
		case "websocket": {
			const webSocketConnection = await openWebSocketConnection(
				flags.appServerUrl,
				flags.connectTimeoutMs,
				dependencies,
			);
			return {
				mode: "websocket",
				close: () => webSocketConnection.close(),
				onFailure: (handler) => webSocketConnection.onUnexpectedClose(handler),
			};
		}
	}
}

function resolveUnixProxyArgs(flags: PiCodexAppServerRuntimeFlags): readonly string[] {
	if (flags.appServerArgs.length > 0 && flags.appServerArgs.join(" ") !== "app-server") {
		return flags.appServerArgs;
	}
	const socketPath = flags.appServerSocketPath;
	if (!socketPath) {
		throw new PiCodexAppServerRuntimeError("unix", "Unix transport requires an app-server socket path.");
	}
	return ["app-server", "proxy", "--sock", socketPath];
}

async function openChildProcessConnection(options: ChildProcessConnectionOptions): Promise<RuntimeConnection> {
	if (options.command.trim().length === 0) {
		throw new PiCodexAppServerRuntimeError(options.mode, "App-server command is required.");
	}
	const child = spawn(options.command, [...options.args], { stdio: "pipe" });
	const connection = new ChildProcessRuntimeConnection(child, options.mode);
	await waitForChildSpawn(child, options.mode, options.connectTimeoutMs);
	return connection;
}

class ChildProcessRuntimeConnection implements RuntimeConnection {
	readonly mode: PiCodexAppServerTransportMode;
	private readonly child: ChildProcessWithoutNullStreams;
	private failureHandler: ((message: string) => void) | undefined;
	private failureMessage: string | undefined;
	private closing = false;

	constructor(child: ChildProcessWithoutNullStreams, mode: PiCodexAppServerTransportMode) {
		this.child = child;
		this.mode = mode;
		child.once("exit", (code, signal) => {
			if (this.closing) return;
			this.recordFailure(formatChildExit(mode, code, signal));
		});
		child.once("error", (error) => {
			if (this.closing) return;
			this.recordFailure(error.message);
		});
	}

	async close(): Promise<void> {
		this.closing = true;
		await stopChild(this.child);
	}

	onFailure(handler: (message: string) => void): void {
		this.failureHandler = handler;
		if (this.failureMessage) {
			const message = this.failureMessage;
			queueMicrotask(() => handler(message));
		}
	}

	private recordFailure(message: string): void {
		this.failureMessage = message;
		this.failureHandler?.(message);
	}
}

function waitForChildSpawn(
	child: ChildProcessWithoutNullStreams,
	mode: PiCodexAppServerTransportMode,
	connectTimeoutMs: number,
): Promise<void> {
	return new Promise((resolve, reject) => {
		const timeout = setTimeout(() => {
			cleanup();
			child.kill("SIGTERM");
			reject(
				new PiCodexAppServerRuntimeError(mode, `App-server process did not spawn within ${connectTimeoutMs}ms.`),
			);
		}, connectTimeoutMs);

		const cleanup = () => {
			clearTimeout(timeout);
			child.off("spawn", onSpawn);
			child.off("error", onError);
		};
		const onSpawn = () => {
			cleanup();
			resolve();
		};
		const onError = (error: Error) => {
			cleanup();
			reject(error);
		};

		child.once("spawn", onSpawn);
		child.once("error", onError);
	});
}

function stopChild(child: ChildProcessWithoutNullStreams): Promise<void> {
	return new Promise((resolve) => {
		if (child.exitCode !== null || child.signalCode !== null) {
			resolve();
			return;
		}
		const timeout = setTimeout(() => {
			child.kill("SIGKILL");
		}, 1000);
		child.once("exit", () => {
			clearTimeout(timeout);
			resolve();
		});
		child.kill("SIGTERM");
	});
}

function formatError(error: unknown): string {
	if (error instanceof Error) return error.message;
	return String(error);
}

function formatChildExit(
	mode: PiCodexAppServerTransportMode,
	code: number | null,
	signal: NodeJS.Signals | null,
): string {
	if (code !== null) return `${mode} app-server process exited unexpectedly with code ${code}.`;
	if (signal !== null) return `${mode} app-server process exited unexpectedly from signal ${signal}.`;
	return `${mode} app-server process exited unexpectedly.`;
}
