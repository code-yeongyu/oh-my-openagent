import { DaemonAlreadyRunningError, startDaemonServer } from "./daemon-server.js";
import { daemonPaths } from "./paths.js";

export async function runDaemon(): Promise<void> {
	process.on("uncaughtException", (error) => logNonFatal("uncaughtException", error));
	process.on("unhandledRejection", (reason) => logNonFatal("unhandledRejection", reason));
	try {
		await startDaemonServer(daemonPaths());
	} catch (error) {
		if (error instanceof DaemonAlreadyRunningError) return;
		throw error;
	}
}

function logNonFatal(kind: string, error: unknown): void {
	const message = error instanceof Error ? (error.stack ?? error.message) : String(error);
	process.stderr.write(`[lsp-daemon] ${kind}: ${message}\n`);
}
