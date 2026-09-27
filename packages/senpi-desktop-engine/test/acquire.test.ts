import { createHash, randomUUID } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { acquireDesktopEngine, type AcquireDesktopEngineOptions } from "../src/acquire";
import { getDesktopEngineFileName } from "../src/locator";
import { DESKTOP_ENGINE_CHECKSUMS_ASSET, desktopEngineReleaseAssetName } from "../src/release-assets";

const version = "5.0.0-beta.123";
const host = "win32-x64";
const asset = desktopEngineReleaseAssetName(host);
if (asset === null) throw new Error("win32-x64 must have a release asset");
const bytes = Buffer.from("verified desktop engine fixture");
const digest = createHash("sha256").update(bytes).digest("hex");

let cacheDir: string;
beforeEach(() => {
	cacheDir = mkdtempSync(join(tmpdir(), "omo-engine-acquire-"));
});
afterEach(() => {
	rmSync(cacheDir, { recursive: true, force: true });
});

function releaseFetch(options: { readonly checksum?: string; readonly manifest?: string; readonly assetStatus?: number; readonly checksumStatus?: number } = {}) {
	const requests: string[] = [];
	return {
		requests,
		fetch: async (input: string | URL | Request): Promise<Response> => {
			const url = String(input);
			requests.push(url);
			if (url.endsWith(`/${asset}`)) {
				return options.assetStatus === undefined ? new Response(bytes) : new Response(null, { status: options.assetStatus });
			}
			if (url.endsWith(`/${DESKTOP_ENGINE_CHECKSUMS_ASSET}`)) {
				return options.checksumStatus === undefined
					? new Response(options.manifest ?? `${options.checksum ?? digest}  ${asset}\n`)
					: new Response(null, { status: options.checksumStatus });
			}
			throw new Error(`Unexpected request: ${url}`);
		},
	};
}

function acquire(options: AcquireDesktopEngineOptions) {
	return acquireDesktopEngine({
		...options,
		locatorOptions: {
			packageDir: join(cacheDir, "empty-package"),
			execDir: join(cacheDir, "empty-bin"),
			repoRoot: join(cacheDir, "empty-repo"),
			runtimeDir: "",
			...options.locatorOptions,
		},
	});
}

describe("acquireDesktopEngine", () => {
	it("prefers a local executable over the release and cache", async () => {
		const packageDir = join(cacheDir, "installed");
		const local = join(packageDir, "native", "prebuilds", host, getDesktopEngineFileName("win32"));
		mkdirSync(join(packageDir, "native", "prebuilds", host), { recursive: true });
		writeFileSync(local, "local binary");
		chmodSync(local, 0o755);
		const { fetch, requests } = releaseFetch();

		const result = await acquire({
			version, host, cacheDir, fetch,
			locatorOptions: { packageDir },
		});

		expect(result.path).toBe(local);
		expect(requests).toEqual([]);
	});

	it("accepts a local engine on a host without release assets, preserving the architecture suffix", async () => {
		const localHost = "linux-x64-musl";
		const packageDir = join(cacheDir, "installed");
		const local = join(packageDir, "native", "prebuilds", localHost, getDesktopEngineFileName("linux"));
		mkdirSync(dirname(local), { recursive: true });
		writeFileSync(local, "locally built");
		chmodSync(local, 0o755);
		const { fetch, requests } = releaseFetch();

		const result = await acquire({
			version: "../unused", host: localHost, cacheDir, fetch,
			locatorOptions: { packageDir, isQuarantined: () => false },
		});

		expect(result.path).toBe(local);
		expect(requests).toEqual([]);
	});

	it("reports quarantined local engines as native-unavailable without downloading or clearing quarantine", async () => {
		const packageDir = join(cacheDir, "installed");
		const local = join(packageDir, "native", "prebuilds", host, getDesktopEngineFileName("win32"));
		mkdirSync(dirname(local), { recursive: true });
		writeFileSync(local, "quarantined binary");
		const { fetch, requests } = releaseFetch();

		const result = await acquire({
			version, host, cacheDir, fetch,
			locatorOptions: { packageDir, isQuarantined: (path) => path === local },
		});

		expect(result.path).toBeNull();
		if (result.path !== null) throw new Error("quarantined local engine must not be bypassed");
		expect(result.diagnostic.code).toBe("native-unavailable");
		expect(result.diagnostic.cause).toContain(local);
		expect(requests).toEqual([]);
	});

	it("converts non-Error fetch failures to native-unavailable diagnostics", async () => {
		const result = await acquire({ version, host, cacheDir, fetch: async () => Promise.reject("transport stopped") });

		expect(result.path).toBeNull();
		if (result.path !== null) throw new Error("transport failure must not resolve an engine");
		expect(result.diagnostic.code).toBe("native-unavailable");
		expect(result.diagnostic.cause).toContain("transport stopped");
	});

	it("reuses a checksum-verified warm cache without another release request", async () => {
		const first = releaseFetch();
		const cold = await acquire({ version, host, cacheDir, fetch: first.fetch });
		expect(cold.path).not.toBeNull();
		const warm = releaseFetch({ assetStatus: 404 });

		const result = await acquire({ version, host, cacheDir, fetch: warm.fetch });

		expect(result.path).toBe(cold.path);
		expect(warm.requests).toEqual([]);
	});

	it("verifies the release checksum before atomically caching an executable", async () => {
		const { fetch, requests } = releaseFetch();

		const result = await acquire({ version, host, cacheDir, fetch });

		if (result.path === null) throw new Error("verified binary must be acquired");
		expect(basename(result.path)).toBe(asset);
		expect(basename(dirname(result.path))).toMatch(new RegExp(`^${digest}-[0-9a-f-]{36}$`));
		expect(readFileSync(result.path)).toEqual(bytes);
		// Windows ignores POSIX chmod bits; the .exe name and verified bytes still apply there.
		if (process.platform !== "win32") expect(statSync(result.path).mode & 0o777).toBe(0o755);
		expect(existsSync(join(cacheDir, version, host, ".current"))).toBe(false);
		expect(readdirSync(join(cacheDir, version, host)).some((entry) => entry.startsWith(".download-"))).toBe(false);
		expect(requests).toEqual([
			`https://github.com/code-yeongyu/oh-my-openagent/releases/download/v${version}/${asset}`,
			`https://github.com/code-yeongyu/oh-my-openagent/releases/download/v${version}/${DESKTOP_ENGINE_CHECKSUMS_ASSET}`,
		]);
	});

	it("rejects a checksum mismatch without caching the binary", async () => {
		const { fetch } = releaseFetch({ checksum: "0".repeat(64) });

		const result = await acquire({ version, host, cacheDir, fetch });

		expect(result.path).toBeNull();
		if (result.path !== null) throw new Error("mismatched binary must be rejected");
		expect(result.diagnostic.code).toBe("native-unavailable");
		expect(result.diagnostic.cause).toMatch(/SHA-256 mismatch/);
		expect(existsSync(join(cacheDir, version, host))).toBe(false);
	});

	it("refetches a corrupted cached binary rather than returning it", async () => {
		const cached = join(cacheDir, version, host, `${digest}-${randomUUID()}`, asset);
		mkdirSync(dirname(cached), { recursive: true });
		writeFileSync(cached, "tampered");
		chmodSync(cached, 0o755);
		const { fetch, requests } = releaseFetch();

		const result = await acquire({ version, host, cacheDir, fetch });

		expect(result.path).not.toBe(cached);
		expect(result.path).not.toBeNull();
		if (result.path === null) throw new Error("replacement must be acquired");
		expect(readFileSync(result.path)).toEqual(bytes);
		expect(readFileSync(cached, "utf8")).toBe("tampered");
		expect(requests).toHaveLength(2);
	});

	it("publishes concurrent downloads in distinct immutable directories", async () => {
		const { fetch } = releaseFetch();

		const [first, second] = await Promise.all([
			acquire({ version, host, cacheDir, fetch }),
			acquire({ version, host, cacheDir, fetch }),
		]);

		expect(first.path).not.toBeNull();
		expect(second.path).not.toBeNull();
		expect(first.path).not.toBe(second.path);
		if (first.path === null || second.path === null) throw new Error("both generations must publish");
		expect(readFileSync(first.path)).toEqual(bytes);
		expect(readFileSync(second.path)).toEqual(bytes);
	});

	it("does not trust an unverified binary outside a published generation", async () => {
		const cached = join(cacheDir, version, host, asset);
		mkdirSync(join(cacheDir, version, host), { recursive: true });
		writeFileSync(cached, "unverified");
		chmodSync(cached, 0o755);
		const { fetch } = releaseFetch({ assetStatus: 404 });

		const result = await acquire({ version, host, cacheDir, fetch });

		expect(result.path).toBeNull();
		expect(readFileSync(cached, "utf8")).toBe("unverified");
	});

	it("reports an absent release asset as native-unavailable", async () => {
		const { fetch } = releaseFetch({ assetStatus: 404 });

		const result = await acquire({ version, host, cacheDir, fetch });

		expect(result.path).toBeNull();
		if (result.path !== null) throw new Error("404 must not resolve an engine");
		expect(result.diagnostic.code).toBe("native-unavailable");
		expect(result.diagnostic.cause).toMatch(/HTTP 404/);
	});

	it("rejects a missing checksum manifest without caching the binary", async () => {
		const { fetch } = releaseFetch({ checksumStatus: 404 });

		const result = await acquire({ version, host, cacheDir, fetch });

		expect(result.path).toBeNull();
		if (result.path !== null) throw new Error("missing manifest must not resolve an engine");
		expect(result.diagnostic.cause).toMatch(/checksums\.txt: HTTP 404/);
		expect(existsSync(join(cacheDir, version, host))).toBe(false);
	});

	it("rejects duplicate checksums for the selected asset", async () => {
		const { fetch } = releaseFetch({ manifest: `${digest}  ${asset}\n${digest}  ${asset}\n` });

		const result = await acquire({ version, host, cacheDir, fetch });

		expect(result.path).toBeNull();
		if (result.path !== null) throw new Error("ambiguous checksum must be rejected");
		expect(result.diagnostic.cause).toMatch(/Duplicate SHA-256/);
		expect(existsSync(join(cacheDir, version, host))).toBe(false);
	});

	it("rejects path-like release checksum names", async () => {
		const { fetch } = releaseFetch({ manifest: `${digest}  ../${asset}\n${digest}  ${asset}\n` });

		const result = await acquire({ version, host, cacheDir, fetch });

		expect(result.path).toBeNull();
		if (result.path !== null) throw new Error("path-like checksum must be rejected");
		expect(result.diagnostic.cause).toMatch(/Invalid desktop engine checksum/);
		expect(existsSync(join(cacheDir, version, host))).toBe(false);
	});

	it("never fetches an unsupported host", async () => {
		const { fetch, requests } = releaseFetch();
		const absent = await acquire({ version, host: "linux-arm64", cacheDir, fetch });

		expect(absent.path).toBeNull();
		expect(requests).toEqual([]);
	});

	it("never fetches an unsafe version", async () => {
		const { fetch, requests } = releaseFetch();
		const unsafe = await acquire({ version: "../other", host, cacheDir, fetch });

		expect(unsafe.path).toBeNull();
		expect(requests).toEqual([]);
	});
});
