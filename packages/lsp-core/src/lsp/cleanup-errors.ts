export function reportBestEffortCleanupError(operation: string, error: unknown): void {
	if (process.env["CODEX_LSP_DEBUG_CLEANUP"] !== "1") return;
	const message = error instanceof Error ? error.message : String(error);
	console.error(`[codex-lsp] ignored ${operation} failure during cleanup: ${message}`);
}
