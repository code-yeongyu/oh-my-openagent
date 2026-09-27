import { createHash, randomUUID } from "node:crypto";
import { accessSync, chmodSync, constants, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import {
	type DesktopEngineLocateDiagnostic,
	type DesktopEngineLocatorOptions,
	isQuarantinedFile,
	locateDesktopEngine,
} from "./locator";
import { DESKTOP_ENGINE_CHECKSUMS_ASSET, DESKTOP_ENGINE_RELEASE_HOSTS, desktopEngineReleaseAssetName } from "./release-assets";

const RELEASE_BASE = "https://github.com/code-yeongyu/oh-my-openagent/releases/download";

export interface AcquireDesktopEngineOptions {
	readonly version: string;
	readonly host: string;
	/** Cache root; version and host are appended to it. */
	readonly cacheDir?: string;
	readonly fetch?: typeof globalThis.fetch;
	/** Overrides the synchronous local search roots; useful for isolated installations. */
	readonly locatorOptions?: DesktopEngineLocatorOptions;
}

export type AcquiredDesktopEngine =
	| { readonly path: string }
	| { readonly path: null; readonly diagnostic: DesktopEngineLocateDiagnostic };

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
		const arch = host.slice(separator + 1);
		const located = locateDesktopEngine({ ...options.locatorOptions, platform, arch });
		attemptedPaths = located.diagnostic?.attemptedPaths ?? [];
		if (located.path !== null) return { path: located.path };
		if (located.diagnostic.code === "quarantined") return unavailable(located.diagnostic.cause);

		const asset = desktopEngineReleaseAssetName(host);
		if (asset === null) return unavailable(`No desktop engine release asset exists for ${host}.`);
		if (!/^[0-9]+\.[0-9]+\.[0-9]+(?:[-+][0-9A-Za-z.-]+)?$/.test(version)) {
			return unavailable(`Invalid omo release version: ${version}`);
		}
		const cacheRoot = options.cacheDir ?? join(homedir(), ".omo", "cache", "senpi-desktop-engine");
		const hostDir = join(cacheRoot, version, host);
		if (existsSync(hostDir)) {
			for (const entry of readdirSync(hostDir)) {
				const match = /^([0-9a-f]{64})-[0-9a-f-]{36}$/.exec(entry);
				if (match === null) continue;
				const cached = join(hostDir, entry, asset);
				attemptedPaths = [...attemptedPaths, cached];
				if (existsSync(cached)
					&& createHash("sha256").update(readFileSync(cached)).digest("hex") === match[1]
					&& !isQuarantinedFile(cached, platform)) {
					try {
						accessSync(cached, constants.X_OK);
						return { path: cached };
					} catch (error) {
						if (!(error instanceof Error && "code" in error)) throw error;
					}
				}
			}
		}

		const fetchRelease = options.fetch ?? globalThis.fetch;
		const base = `${RELEASE_BASE}/v${version}`;
		attemptedPaths = [...attemptedPaths, join(hostDir, asset)];
		const [binaryResponse, checksumsResponse] = await Promise.all([
			fetchRelease(`${base}/${asset}`, { signal: AbortSignal.timeout(30_000) }),
			fetchRelease(`${base}/${DESKTOP_ENGINE_CHECKSUMS_ASSET}`, { signal: AbortSignal.timeout(30_000) }),
		]);
		if (!binaryResponse.ok) return unavailable(`${asset}: HTTP ${binaryResponse.status}`);
		if (!checksumsResponse.ok) return unavailable(`${DESKTOP_ENGINE_CHECKSUMS_ASSET}: HTTP ${checksumsResponse.status}`);

		const checksumLines = (await checksumsResponse.text()).trimEnd().split(/\r?\n/);
		const seen = new Set<string>();
		let expected: string | undefined;
		for (const line of checksumLines) {
			const match = /^([a-fA-F0-9]{64})  ([A-Za-z0-9.-]+)$/.exec(line);
			const name = match?.[2];
			if (name === undefined || !DESKTOP_ENGINE_RELEASE_HOSTS.some((supported) => desktopEngineReleaseAssetName(supported) === name)) {
				return unavailable("Invalid desktop engine checksum entry or asset name");
			}
			if (seen.has(name)) return unavailable(`Duplicate SHA-256 checksum for ${name}`);
			seen.add(name);
			if (name === asset) expected = match?.[1];
		}
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
		return { path: join(generation, asset) };
	} catch (error) {
		return unavailable(error instanceof Error ? error.message : String(error));
	}
}
