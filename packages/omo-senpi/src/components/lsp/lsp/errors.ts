export class LspConnectionClosedError extends Error {
	override readonly name = "LspConnectionClosedError";

	constructor(
		readonly serverId: string,
		readonly root: string,
		message?: string,
	) {
		super(message ?? `LSP connection closed for ${serverId} at ${root}`);
	}
}

export class LspProcessExitedError extends Error {
	override readonly name = "LspProcessExitedError";

	constructor(
		readonly serverId: string,
		readonly root: string,
		readonly exitCode: number | null,
		readonly stderrTail?: string,
	) {
		const stderrSuffix = stderrTail ? `\nstderr tail: ${stderrTail}` : "";
		super(`LSP server ${serverId} at ${root} exited with code ${exitCode ?? "null"}${stderrSuffix}`);
	}
}

export class LspRequestTimeoutError extends Error {
	override readonly name = "LspRequestTimeoutError";

	constructor(
		readonly method: string,
		readonly stderrTail?: string,
	) {
		const stderrSuffix = stderrTail ? `\nrecent stderr: ${stderrTail}` : "";
		super(`LSP request timeout (method: ${method})${stderrSuffix}`);
	}
}

export class LspInvalidPathError extends Error {
	override readonly name = "LspInvalidPathError";
}

export class LspServerLookupError extends Error {
	override readonly name = "LspServerLookupError";
}

export class LspServerInitializingError extends Error {
	override readonly name = "LspServerInitializingError";

	constructor(readonly originalError: LspRequestTimeoutError) {
		super(
			`LSP server is still initializing. Please retry in a few seconds. Original error: ${originalError.message}`,
		);
	}
}

export class LspProcessSpawnError extends Error {
	override readonly name = "LspProcessSpawnError";
}

export function isLspDeadConnectionError(err: unknown): err is LspConnectionClosedError | LspProcessExitedError {
	return err instanceof LspConnectionClosedError || err instanceof LspProcessExitedError;
}
