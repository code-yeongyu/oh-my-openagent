export type CleanupErrorLogger = (message: string) => void;

function writeCleanupError(message: string): void {
	process.stderr.write(`${message}\n`);
}

export function reportBestEffortCleanupError(
	operation: string,
	error: unknown,
	logger: CleanupErrorLogger = writeCleanupError,
): void {
	const message = error instanceof Error ? error.message : String(error);
	logger(`[lsp] ignored ${operation} failure during cleanup: ${message}`);
}
