import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";

export const INSTALL_SNAPSHOT_FILE = "lazycodex-install.json";

export function resolveInstallSnapshotPath(env, pluginRoot) {
	if (env.LAZYCODEX_INSTALLED_VERSION_PATH?.trim()) return env.LAZYCODEX_INSTALLED_VERSION_PATH;
	return join(pluginRoot, INSTALL_SNAPSHOT_FILE);
}

export function detectInstallFlow({ pluginRoot, env = {} } = {}) {
	const snapshot = classifySnapshotPath(resolveInstallSnapshotPath(env, pluginRoot));
	if (snapshot.kind === "file") return { flow: "npx-local", reason: "install-snapshot-present" };
	if (snapshot.kind !== "absent") {
		return { flow: "unknown", reason: `install-snapshot-${snapshot.kind}: ${snapshot.detail}` };
	}
	if (isVersionedWorkspaceManifest(join(pluginRoot, "..", "..", "..", "package.json"))) {
		return { flow: "npx-local", reason: "workspace-tree" };
	}
	return { flow: "marketplace", reason: "install-snapshot-absent" };
}

function classifySnapshotPath(path) {
	try {
		if (statSync(path).isFile()) return { kind: "file" };
		return { kind: "not-file", detail: "not-a-regular-file" };
	} catch (error) {
		if (!(error instanceof Error)) throw error;
		if ("code" in error && error.code === "ENOENT") return { kind: "absent" };
		return { kind: "unreadable", detail: "code" in error ? String(error.code) : "unknown-error" };
	}
}

function isVersionedWorkspaceManifest(path) {
	try {
		const parsed = JSON.parse(readFileSync(path, "utf8"));
		if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return false;
		return typeof parsed.version === "string" && parsed.version.trim().length > 0;
	} catch (error) {
		if (error instanceof Error) return false;
		throw error;
	}
}
