import { createHash, randomUUID } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

export interface StableEngineSource {
	readonly path: string;
	readonly sha256: string;
	readonly version: string;
	readonly directory: string;
}

export function engineSha256(path: string): string {
	return createHash("sha256").update(readFileSync(path)).digest("hex");
}

/**
 * The callback must spawn synchronously: macOS posix_spawn has committed the image before
 * returning. SQLite's exclusive file lock also works across processes and dies with its owner.
 */
export function launchStableEngine<T>(
	source: StableEngineSource,
	spawn: (path: string) => T,
	verifySignature: (path: string) => boolean,
): { readonly path: string; readonly value: T } {
	mkdirSync(source.directory, { recursive: true });
	const path = join(source.directory, "senpi-desktop-engine");
	const lock = new DatabaseSync(join(source.directory, "launch.lock"));
	try {
		lock.exec("PRAGMA busy_timeout = 30000");
		lock.exec("BEGIN EXCLUSIVE");
		if (!existsSync(path) || engineSha256(path) !== source.sha256) {
			const staging = join(source.directory, `.engine-${randomUUID()}`);
			try {
				writeFileSync(staging, readFileSync(source.path), { flag: "wx", mode: 0o755 });
				chmodSync(staging, 0o755);
				if (engineSha256(staging) !== source.sha256) throw new Error("Desktop engine source SHA-256 changed");
				if (!verifySignature(staging)) throw new Error("Desktop engine release signature verification failed");
				renameSync(staging, path);
			} finally {
				rmSync(staging, { force: true });
			}
		}
		if (engineSha256(path) !== source.sha256) throw new Error("Stable desktop engine SHA-256 mismatch");
		writeFileSync(join(source.directory, "release.json"), JSON.stringify({
			version: source.version,
			sha256: source.sha256,
		}));
		const value = spawn(path);
		return { path, value };
	} finally {
		lock.close();
	}
}
