import { renameSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { getLspManager } from "@oh-my-opencode/lsp-core/lsp/manager";
import { setPrivateFileMode } from "./ipc-protocol.js";
import type { DaemonPaths } from "./paths.js";

const STATUS_MIRROR_INTERVAL_MS = 2_000;
const STATUS_MIRROR_FILE_NAME = "status.json";
const STATUS_MIRROR_VERSION = 1;

export function startStatusMirror(paths: DaemonPaths, intervalMs = STATUS_MIRROR_INTERVAL_MS): () => void {
	const statusPath = join(paths.dir, STATUS_MIRROR_FILE_NAME);
	const tempPath = `${statusPath}.tmp`;

	const writeStatus = (): void => {
		try {
			const status = {
				version: STATUS_MIRROR_VERSION,
				updatedAt: Date.now(),
				pid: process.pid,
				clients: getLspManager()
					.getSnapshot()
					.map((snapshot) => ({
						serverId: snapshot.serverId,
						root: snapshot.root,
						alive: snapshot.alive,
						isInitializing: snapshot.isInitializing,
						refCount: snapshot.refCount,
					})),
			};
			writeFileSync(tempPath, `${JSON.stringify(status)}\n`, { mode: 0o600 });
			setPrivateFileMode(tempPath);
			renameSync(tempPath, statusPath);
		} catch (error) {
			logMirrorError(error);
		}
	};

	writeStatus();
	const timer = setInterval(writeStatus, intervalMs);
	timer.unref();

	return () => {
		clearInterval(timer);
		unlinkQuietly(statusPath);
		unlinkQuietly(tempPath);
	};
}

function unlinkQuietly(path: string): void {
	try {
		unlinkSync(path);
	} catch (error) {
		if (!(error instanceof Error)) throw error;
	}
}

function logMirrorError(error: unknown): void {
	const message = error instanceof Error ? (error.stack ?? error.message) : String(error);
	process.stderr.write(`[lsp-daemon] status mirror: ${message}\n`);
}
