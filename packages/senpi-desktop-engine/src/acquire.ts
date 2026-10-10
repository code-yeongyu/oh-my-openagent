import { createHash, randomUUID } from "node:crypto";
import { accessSync, chmodSync, constants, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import {
	type DesktopEngineLocateDiagnostic,
	type DesktopEngineLocatorOptions,
	getDesktopEngineFileName,
	isQuarantinedFile,
	locateDesktopEngine,
} from "./locator";
import { parseDesktopEngineChecksums } from "./checksums";
import { DESKTOP_ENGINE_CHECKSUMS_ASSET, desktopEngineReleaseAssetName } from "./release-assets";
import { isDesktopEngineRelease } from "./release-signature";

const RELEASE_BASE = "https://github.com/code-yeongyu/oh-my-openagent/releases/download";
const MUSL_SUFFIX = "-musl";

export interface AcquireDesktopEngineOptions {
	readonly version: string;
	readonly host: string;
	/** Cache root; version and host are appended to it. */
	readonly cacheDir?: string;
	readonly fetch?: typeof globalThis.fetch;
	/** Overrides the synchronous local search roots; useful for isolated installations. */
	readonly locatorOptions?: DesktopEngineLocatorOptions;
	/** Doctor may inspect installed engines, but must not download a missing one. */
	readonly allowDownload?: boolean;
	/** Stable installation root; host is appended, never the release version. */
	readonly installDir?: string;
	readonly isReleaseEngine?: (path: string) => boolean;
}

export type AcquiredDesktopEngine =
	| { readonly path: string; readonly sha256?: string }
	| { readonly path: null; readonly diagnostic: DesktopEngineLocateDiagnostic };

/** Finds a verified, executable release-cache generation without acquiring or starting an engine. */
export function findCachedDesktopEngine(
	options: Pick<AcquireDesktopEngineOptions, "version" | "host" | "cacheDir">,
	onAttempt?: (path: string) => void,
): { readonly path: string; readonly sha256: string } | { readonly path: null; readonly attemptedPaths: readonly string[] } {
	const { host, version } = options;
	const asset = desktopEngineReleaseAssetName(host);
	let attemptedPaths: readonly string[] = [];
	if (asset === null) return { path: null, attemptedPaths };
	const platform = host.slice(0, host.indexOf("-"));
	const cacheRoot = options.cacheDir ?? join(homedir(), ".omo", "cache", "senpi-desktop-engine");
	const hostDir = join(cacheRoot, version, host);
	if (existsSync(hostDir)) {
		for (const entry of readdirSync(hostDir)) {
			const match = /^([0-9a-f]{64})-[0-9a-f-]{36}$/.exec(entry);
			if (match === null) continue;
			const cached = join(hostDir, entry, asset);
			attemptedPaths = [...attemptedPaths, cached];
			onAttempt?.(cached);
			if (existsSync(cached)
				&& createHash("sha256").update(readFileSync(cached)).digest("hex") === match[1]
				&& !isQuarantinedFile(cached, platform)) {
				try {
					accessSync(cached, constants.X_OK);
					return { path: cached, sha256: match[1] };
				} catch (error) {
					if (!(error instanceof Error && "code" in error)) throw error;
				}
			}
		}
	}
	return { path: null, attemptedPaths };
}

/** Async release acquisition leaves the synchronous locator and enginePath override untouched. */
export async function acquireDesktopEngine(options: AcquireDesktopEngineOptions): Promise<AcquiredDesktopEngine> {
	const { host, version } = options;
	let attemptedPaths: readonly string[] = [];
	const unavailable = (cause: string): AcquiredDesktopEngine => ({
		path: null,
		diagnostic: {
			code: "native-unavailable",
			host,
			attemptedPaths,
			message: `No senpi-desktop-engine binary is available for ${host}.`,
			cause,
		},
	});

	try {
		const separator = host.indexOf("-");
		if (separator < 1 || separator === host.length - 1) return unavailable(`Invalid host: ${host}`);
		const platform = host.slice(0, separator);
		const rest = host.slice(separator + 1);
		// The host string names the libc; this process's libc must not re-decide it.
		const libc = platform === "linux" && rest.endsWith(MUSL_SUFFIX) ? "musl" : "glibc";
		const arch = libc === "musl" ? rest.slice(0, -MUSL_SUFFIX.length) : rest;
		const located = locateDesktopEngine({ ...options.locatorOptions, platform, arch, libc });
		attemptedPaths = located.diagnostic?.attemptedPaths ?? [];
		if (located.path !== null) {
			const runtimeDir = options.locatorOptions?.runtimeDir ?? process.env.OMO_PACKAGE_DIR;
			const payload = runtimeDir && join(runtimeDir, "native", "prebuilds", host, getDesktopEngineFileName(platform));
			if (platform === "darwin" && located.path === payload && runtimeDir
				&& (options.isReleaseEngine ?? isDesktopEngineRelease)(located.path)) {
				const manifest: unknown = JSON.parse(readFileSync(join(runtimeDir, "package.json"), "utf8"));
				if (typeof manifest === "object" && manifest !== null
					&& Reflect.get(manifest, "name") === "omo" && Reflect.get(manifest, "version") === version) {
					return { path: located.path, sha256: createHash("sha256").update(readFileSync(located.path)).digest("hex") };
				}
				return unavailable("Extracted desktop engine does not belong to the requested omo release");
			}
			return { path: located.path };
		}
		if (located.diagnostic.code === "quarantined") return unavailable(located.diagnostic.cause);

		const asset = desktopEngineReleaseAssetName(host);
		if (asset === null) return { path: null, diagnostic: {
			...located.diagnostic,
			reason: "no-release-asset",
			message: `No senpi-desktop-engine is built for ${host}; computer use is unavailable on this host.`,
		} };
		if (!/^[0-9]+\.[0-9]+\.[0-9]+(?:[-+][0-9A-Za-z.-]+)?$/.test(version)) {
			return unavailable(`Invalid omo release version: ${version}`);
		}
		const cacheRoot = options.cacheDir ?? join(homedir(), ".omo", "cache", "senpi-desktop-engine");
		const hostDir = join(cacheRoot, version, host);
		const cached = findCachedDesktopEngine(options, (path) => {
			attemptedPaths = [...attemptedPaths, path];
		});
		if (cached.path !== null) return cached;

		if (options.allowDownload === false) return unavailable("No installed release engine");
		const fetchRelease = options.fetch ?? globalThis.fetch;
		const base = `${RELEASE_BASE}/v${version}`;
		attemptedPaths = [...attemptedPaths, join(hostDir, asset)];
		const [binaryResponse, checksumsResponse] = await Promise.all([
			fetchRelease(`${base}/${asset}`, { signal: AbortSignal.timeout(30_000) }),
			fetchRelease(`${base}/${DESKTOP_ENGINE_CHECKSUMS_ASSET}`, { signal: AbortSignal.timeout(30_000) }),
		]);
		if (!binaryResponse.ok) return unavailable(`${asset}: HTTP ${binaryResponse.status}`);
		if (!checksumsResponse.ok) return unavailable(`${DESKTOP_ENGINE_CHECKSUMS_ASSET}: HTTP ${checksumsResponse.status}`);

		const parsed = parseDesktopEngineChecksums(await checksumsResponse.text());
		if (parsed.error !== null) return unavailable(parsed.error);
		const expected = parsed.checksums.get(asset);
		if (expected === undefined) return unavailable(`No SHA-256 checksum for ${asset}`);
		const binary = Buffer.from(await binaryResponse.arrayBuffer());
		const actual = createHash("sha256").update(binary).digest("hex");
		if (actual.toLowerCase() !== expected.toLowerCase()) return unavailable(`SHA-256 mismatch for ${asset}`);

		mkdirSync(hostDir, { recursive: true });
		const stagingDir = mkdtempSync(join(hostDir, ".download-"));
		const generation = join(hostDir, `${actual}-${randomUUID()}`);
		try {
			const staged = join(stagingDir, asset);
			writeFileSync(staged, binary);
			chmodSync(staged, 0o755);
			renameSync(stagingDir, generation);
		} finally {
			rmSync(stagingDir, { recursive: true, force: true });
		}
		return { path: join(generation, asset), sha256: actual };
	} catch (error) {
		return unavailable(error instanceof Error ? error.message : String(error));
	}
}

/** Acquire anew for every spawn; a shared stable pathname is not a release identity. */
export async function launchDesktopEngine<T>(
	options: AcquireDesktopEngineOptions,
	spawn: (path: string) => T,
	acquire: (options: AcquireDesktopEngineOptions) => Promise<AcquiredDesktopEngine> = acquireDesktopEngine,
): Promise<{ readonly path: string; readonly value: T } | Extract<AcquiredDesktopEngine, { path: null }>> {
	const source = await acquire(options);
	if (source.path === null) return source;
	const verifySignature = options.isReleaseEngine ?? isDesktopEngineRelease;
	if (!options.host.startsWith("darwin-") || source.sha256 === undefined || !verifySignature(source.path)) {
		return { path: source.path, value: spawn(source.path) };
	}
	const { launchStableEngine } = await import("./stable-launch");
	const launched = launchStableEngine({
		path: source.path,
		sha256: source.sha256,
		version: options.version,
		directory: join(options.installDir ?? join(homedir(), ".omo", "engines", "senpi-desktop-engine"), options.host),
	}, (path) => {
		if (isQuarantinedFile(path)) {
			return {
				path: null,
				diagnostic: {
					code: "quarantined",
					host: options.host,
					attemptedPaths: [path],
					message: "The stable desktop engine is quarantined by macOS Gatekeeper.",
					cause: `${path}: blocked because com.apple.quarantine is present`,
				},
			} as const;
		}
		return { path, value: spawn(path) };
	}, verifySignature);
	return launched.value;
}
