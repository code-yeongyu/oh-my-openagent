import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";

const requireFromHere = createRequire(import.meta.url);

const MAX_SOCKET_PATH_LENGTH = 100;

export interface DaemonPaths {
	version: string;
	dir: string;
	socket: string;
	lock: string;
	pid: string;
	log: string;
}

export function resolveDaemonVersion(requireFn: (id: string) => unknown = requireFromHere): string {
	for (const candidate of ["./package.json", "../package.json"]) {
		try {
			const pkg = requireFn(candidate) as { version?: unknown };
			if (typeof pkg.version === "string" && pkg.version.length > 0) return pkg.version;
		} catch {}
	}
	return "0";
}

export function daemonBaseDir(env: NodeJS.ProcessEnv = process.env): string {
	const explicit = env["CODEX_LSP_DAEMON_DIR"]?.trim();
	if (explicit) return explicit;
	const pluginData = env["PLUGIN_DATA"]?.trim();
	if (pluginData) return join(pluginData, "daemon");
	const codexHome = env["CODEX_HOME"]?.trim();
	const home = codexHome && codexHome.length > 0 ? codexHome : join(homedir(), ".codex");
	return join(home, "codex-lsp", "daemon");
}

export function daemonPaths(
	env: NodeJS.ProcessEnv = process.env,
	version: string = resolveDaemonVersion(),
): DaemonPaths {
	const dir = join(daemonBaseDir(env), `v${version}`);
	return {
		version,
		dir,
		socket: resolveSocketPath(dir, version),
		lock: join(dir, "daemon.lock"),
		pid: join(dir, "daemon.pid"),
		log: join(dir, "daemon.log"),
	};
}

function resolveSocketPath(dir: string, version: string): string {
	const digest = createHash("sha256").update(dir).digest("hex").slice(0, 16);
	if (process.platform === "win32") {
		return `\\\\.\\pipe\\omo-lsp-${version}-${digest}`;
	}
	const natural = join(dir, "daemon.sock");
	if (natural.length < MAX_SOCKET_PATH_LENGTH) return natural;
	return join(tmpdir(), `omo-lsp-${version}-${digest}.sock`);
}
