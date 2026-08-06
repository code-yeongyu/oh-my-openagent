import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { homedir, tmpdir, userInfo } from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

import {
	type DaemonRuntimeDefaults,
	OMO_LSP_DAEMON_DIR,
	resolveDaemonRuntime,
	validateDaemonVersion,
} from "./runtime-contract.js";

export {
	InvalidDaemonVersionError,
	OMO_LSP_DAEMON_DIR,
	OMO_LSP_DAEMON_VERSION,
	validateDaemonVersion,
} from "./runtime-contract.js";

const requireFromHere = createRequire(import.meta.url);
const MAX_SOCKET_PATH_LENGTH = 100;

export interface DaemonPathOperations {
	readonly isAbsolute: (value: string) => boolean;
	readonly join: (...parts: string[]) => string;
	readonly resolve: (...parts: string[]) => string;
}

export interface DaemonPlatform {
	readonly platform: NodeJS.Platform;
	readonly homedir: () => string;
	readonly tmpdir: () => string;
	readonly getuid: () => number | undefined;
	readonly username: () => string;
	readonly path: DaemonPathOperations;
}

export class InvalidDaemonDirectoryError extends Error {
	readonly code = "invalid_daemon_directory";
	readonly directory: string;

	constructor(directory: string) {
		super(`${OMO_LSP_DAEMON_DIR} must be an absolute path`);
		this.name = "InvalidDaemonDirectoryError";
		this.directory = directory;
	}
}

export interface DaemonPaths {
	readonly version: string;
	readonly cliPath: string;
	readonly dir: string;
	readonly socket: string;
	readonly lock: string;
	readonly pid: string;
	readonly auth: string;
	readonly endpoint: string;
	readonly owner: string;
	readonly log: string;
}

export function resolveDaemonVersion(requireFn: (id: string) => unknown = requireFromHere): string {
	for (const candidate of ["./package.json", "../package.json"]) {
		let loaded: unknown;
		try {
			loaded = requireFn(candidate);
		} catch (error) {
			if (!(error instanceof Error)) throw error;
			continue;
		}
		if (typeof loaded === "object" && loaded !== null && "version" in loaded) {
			const version = Reflect.get(loaded, "version");
			if (typeof version === "string") return validateDaemonVersion(version);
		}
	}
	return "0";
}

export function packagedRuntimeDefaults(): DaemonRuntimeDefaults {
	return {
		cliPath: fileURLToPath(new URL("./cli.js", import.meta.url)),
		version: resolveDaemonVersion(),
	};
}

export function daemonBaseDir(
	env: NodeJS.ProcessEnv = process.env,
	platform: DaemonPlatform = defaultDaemonPlatform(),
): string {
	const override = env[OMO_LSP_DAEMON_DIR];
	if (override !== undefined) {
		if (!platform.path.isAbsolute(override)) throw new InvalidDaemonDirectoryError(override);
		return platform.path.resolve(override);
	}
	return platform.path.resolve(platform.path.join(platform.homedir(), ".omo", "lsp-daemon"));
}

export function daemonPaths(
	env: NodeJS.ProcessEnv = process.env,
	runtimeDefaults: DaemonRuntimeDefaults = packagedRuntimeDefaults(),
	platform: DaemonPlatform = defaultDaemonPlatform(),
): DaemonPaths {
	const runtime = resolveDaemonRuntime(env, runtimeDefaults);
	const baseDir = daemonBaseDir(env, platform);
	const dir = platform.path.resolve(platform.path.join(baseDir, `v${runtime.version}`));
	return {
		version: runtime.version,
		cliPath: runtime.cliPath,
		dir,
		socket: resolveSocketPath(dir, runtime.version, platform),
		lock: platform.path.join(dir, "daemon.lock"),
		pid: platform.path.join(dir, "daemon.pid"),
		auth: platform.path.join(dir, "daemon.auth"),
		endpoint: platform.path.join(dir, "daemon.endpoint"),
		owner: platform.path.join(dir, "daemon.owner"),
		log: platform.path.join(dir, "daemon.log"),
	};
}

function defaultDaemonPlatform(): DaemonPlatform {
	return {
		platform: process.platform,
		homedir,
		tmpdir,
		getuid: () => (typeof process.getuid === "function" ? process.getuid() : undefined),
		username: () => userInfo().username,
		path,
	};
}

function resolveSocketPath(dir: string, version: string, platform: DaemonPlatform): string {
	const canonicalVersionDir = platform.path.resolve(dir);
	if (platform.platform === "win32") {
		const currentUserDiscriminator = `${platform.getuid() ?? "win"}:${platform.username()}:${platform.path.resolve(platform.homedir())}`;
		const digest = shortDigest(`${canonicalVersionDir}\0${currentUserDiscriminator}`);
		return `\\\\.\\pipe\\omo-lsp-${version}-${digest}`;
	}

	const natural = platform.path.join(canonicalVersionDir, "daemon.sock");
	if (natural.length < MAX_SOCKET_PATH_LENGTH) return natural;
	return platform.path.join(platform.tmpdir(), `omo-lsp-${version}-${shortDigest(canonicalVersionDir)}`, "daemon.sock");
}

function shortDigest(value: string): string {
	return createHash("sha256").update(value).digest("hex").slice(0, 16);
}
