import fs, { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const VALID_ENTRY = {
	enabled: true,
	trustedHash: "sha256:packed-consumer",
	scope: "global",
	sourcePath: "/packed-consumer/hooks.json",
	commandPreview: "node hook.mjs",
	updatedAt: "2026-09-03T00:00:00.000Z",
};

export function snapshot(revision) {
	return {
		version: 1,
		hooks: {
			[`hook-${revision}`]: {
				...VALID_ENTRY,
				trustedHash: `sha256:${revision}`,
			},
		},
	};
}

const [mode, ...args] = process.argv.slice(2);
const isChildEntry =
	process.argv[1] !== undefined &&
	pathToFileURL(process.argv[1]).href === import.meta.url;

function pauseAtBoundary(message, barrierPath) {
	process.send?.(message);
	readFileSync(barrierPath, "utf8");
}

async function loadStorage(senpiRoot, agentDir, cwd) {
	const { FileHookStateStorage } = await import(
		pathToFileURL(
			join(senpiRoot, "dist/core/extensions/builtin/hooks/trust-storage.js"),
		).href
	);
	return new FileHookStateStorage({ agentDir, cwd });
}

if (isChildEntry && mode === "hold-lock") {
	const [lockPath, statePath, malformed] = args;
	if (lockPath === undefined || statePath === undefined) {
		throw new Error("hold-lock paths are required");
	}
	mkdirSync(lockPath, { recursive: false });
	if (malformed === "malformed") {
		writeFileSync(statePath, "{ legacy writer", "utf8");
	}
	process.send?.("ready");
	process.on("message", (message) => {
		if (
			typeof message !== "object" ||
			message === null ||
			message.kind !== "release"
		)
			return;
		if (message.publication !== undefined) {
			writeFileSync(
				statePath,
				`${JSON.stringify(message.publication)}\n`,
				"utf8",
			);
		}
		rmSync(lockPath, { recursive: true, force: true });
		process.send?.("released");
		process.disconnect();
	});
} else if (isChildEntry && mode === "read-after-publication") {
	const [senpiRoot, agentDir, cwd, statePath, barrierPath] = args;
	if (
		senpiRoot === undefined ||
		agentDir === undefined ||
		cwd === undefined ||
		statePath === undefined ||
		barrierPath === undefined
	) {
		throw new Error("read-after-publication arguments are required");
	}
	const originalReadFileSync = fs.readFileSync;
	let reachedBoundary = false;
	fs.readFileSync = (...readArgs) => {
		const result = originalReadFileSync(...readArgs);
		if (!reachedBoundary && readArgs[0] === statePath) {
			reachedBoundary = true;
			pauseAtBoundary("read-boundary", barrierPath);
		}
		return result;
	};
	syncBuiltinESMExports();
	const storage = await loadStorage(senpiRoot, agentDir, cwd);
	process.send?.("ready");
	process.on("message", (message) => {
		if (message !== "start") return;
		const state = storage.read("global");
		process.send?.({ kind: "read-complete", state });
		process.disconnect();
	});
} else if (isChildEntry && mode === "publish-at-rename") {
	const [senpiRoot, agentDir, cwd, statePath, barrierPath] = args;
	if (
		senpiRoot === undefined ||
		agentDir === undefined ||
		cwd === undefined ||
		statePath === undefined ||
		barrierPath === undefined
	) {
		throw new Error("publish-at-rename arguments are required");
	}
	const originalRenameSync = fs.renameSync;
	fs.renameSync = (oldPath, newPath) => {
		if (newPath === statePath)
			pauseAtBoundary("publication-boundary", barrierPath);
		originalRenameSync(oldPath, newPath);
	};
	syncBuiltinESMExports();
	const storage = await loadStorage(senpiRoot, agentDir, cwd);
	process.send?.("ready");
	process.on("message", (message) => {
		if (
			typeof message !== "object" ||
			message === null ||
			message.kind !== "publish"
		)
			return;
		const state = storage.update("global", () => message.state);
		process.send?.({ kind: "publication-complete", state });
		process.disconnect();
	});
} else if (isChildEntry && mode === "observe-once") {
	const [statePath] = args;
	if (statePath === undefined) {
		throw new Error("observe-once state path is required");
	}
	process.send?.("ready");
	process.on("message", (message) => {
		if (message !== "inspect") return;
		process.send?.({
			kind: "observation-complete",
			state: JSON.parse(readFileSync(statePath, "utf8")),
		});
		process.disconnect();
	});
} else if (isChildEntry) {
	throw new Error(`Unknown child mode: ${mode}`);
}
