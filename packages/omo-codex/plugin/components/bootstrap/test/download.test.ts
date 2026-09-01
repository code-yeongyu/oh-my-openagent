import { afterEach, describe, expect, it } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";

import {
	ChecksumMismatchError,
	DownloadError,
	downloadChecksummedAsset,
	downloadFromManifest,
	loadAssetManifest,
	UnsupportedPlatformError,
	type FetchLike,
} from "../src/download.ts";

const temporaryDirectories: string[] = [];

function createTemporaryDirectory(prefix: string): string {
	const directory = mkdtempSync(join(tmpdir(), prefix));
	temporaryDirectories.push(directory);
	return directory;
}

afterEach(() => {
	for (const directory of temporaryDirectories.splice(0)) {
		rmSync(directory, { recursive: true, force: true });
	}
});

function sha256Hex(bytes: Uint8Array): string {
	return createHash("sha256").update(bytes).digest("hex");
}

function fetchReturning(bytes: Uint8Array, status = 200): { fetchImpl: FetchLike; calls: string[] } {
	const calls: string[] = [];
	const fetchImpl: FetchLike = async (url) => {
		calls.push(url);
		return new Response(status === 200 ? bytes : null, { status });
	};
	return { calls, fetchImpl };
}

async function writeManifestFixture(
	manifestsDir: string,
	platforms: Record<string, { url: string; sha256: string }>,
): Promise<void> {
	await mkdir(manifestsDir, { recursive: true });
	const manifest = { name: "tool", platforms, version: "1.0.0" };
	await writeFile(join(manifestsDir, "tool.json"), JSON.stringify(manifest, null, "\t"), "utf8");
}

describe("downloadChecksummedAsset", () => {
	it("#given a fetch that returns the pinned bytes #when downloading #then the destination holds exactly those bytes and no partial files remain", async () => {
		// given
		const directory = createTemporaryDirectory("omo-bootstrap-download-");
		const payload = new TextEncoder().encode("pinned asset payload");
		const destination = join(directory, "asset.zip");
		const { calls, fetchImpl } = fetchReturning(payload);

		// when
		const written = await downloadChecksummedAsset({
			destination,
			fetchImpl,
			sha256: sha256Hex(payload),
			url: "https://example.invalid/assets/asset.zip",
		});

		// then
		expect(written).toBe(destination);
		expect(calls).toEqual(["https://example.invalid/assets/asset.zip"]);
		expect(new Uint8Array(await readFile(destination))).toEqual(payload);
		expect(await readdir(directory)).toEqual(["asset.zip"]);
	});

	it("#given a fetch that returns corrupted bytes #when downloading #then a checksum mismatch error names both hashes and the partial file is deleted", async () => {
		// given
		const directory = createTemporaryDirectory("omo-bootstrap-download-");
		const pinned = new TextEncoder().encode("pinned asset payload");
		const corrupted = new TextEncoder().encode("corrupted asset payload");
		const destination = join(directory, "asset.zip");
		const expectedSha256 = sha256Hex(pinned);
		const actualSha256 = sha256Hex(corrupted);

		// when
		const failure = downloadChecksummedAsset({
			destination,
			fetchImpl: fetchReturning(corrupted).fetchImpl,
			sha256: expectedSha256,
			url: "https://example.invalid/assets/asset.zip",
		});

		// then
		const error = (await failure.then(
			() => {
				throw new Error("expected downloadChecksummedAsset to reject");
			},
			(caught: unknown) => caught,
		)) as ChecksumMismatchError;
		expect(error).toBeInstanceOf(ChecksumMismatchError);
		expect(error.code).toBe("checksum-mismatch");
		expect(error.message).toMatch(/checksum mismatch/i);
		expect(error.message).toContain(expectedSha256);
		expect(error.message).toContain(actualSha256);
		expect(error.expectedSha256).toBe(expectedSha256);
		expect(error.actualSha256).toBe(actualSha256);
		expect(await readdir(directory)).toEqual([]);
	});

	it("#given a non-2xx response #when downloading #then a typed download-failed error is thrown and nothing is written", async () => {
		// given
		const directory = createTemporaryDirectory("omo-bootstrap-download-");
		const destination = join(directory, "asset.zip");

		// when
		const failure = downloadChecksummedAsset({
			destination,
			fetchImpl: fetchReturning(new Uint8Array(), 404).fetchImpl,
			sha256: sha256Hex(new Uint8Array()),
			url: "https://example.invalid/assets/missing.zip",
		});

		// then
		const error = (await failure.then(
			() => {
				throw new Error("expected downloadChecksummedAsset to reject");
			},
			(caught: unknown) => caught,
		)) as DownloadError;
		expect(error).toBeInstanceOf(DownloadError);
		expect(error.code).toBe("download-failed");
		expect(error.message).toContain("404");
		expect(await readdir(directory)).toEqual([]);
	});

	it("#given HTTPS_PROXY is set #when the direct download attempt fails #then the error names the v1 proxy limitation", async () => {
		// given
		const directory = createTemporaryDirectory("omo-bootstrap-download-");
		const calls: string[] = [];
		const fetchImpl: FetchLike = async (url) => {
			calls.push(url);
			throw new Error("connect ETIMEDOUT 203.0.113.7:443");
		};

		// when
		const failure = downloadChecksummedAsset({
			destination: join(directory, "asset.zip"),
			env: { HTTPS_PROXY: "http://proxy.corp.example:3128" },
			fetchImpl,
			sha256: sha256Hex(new Uint8Array()),
			url: "https://example.invalid/assets/asset.zip",
		});

		// then
		const error = (await failure.then(
			() => {
				throw new Error("expected downloadChecksummedAsset to reject");
			},
			(caught: unknown) => caught,
		)) as DownloadError;
		expect(calls).toHaveLength(1);
		expect(error).toBeInstanceOf(DownloadError);
		expect(error.code).toBe("download-failed");
		expect(error.message).toContain("ETIMEDOUT");
		expect(error.message).toContain("HTTPS_PROXY");
		expect(error.message).toMatch(/does not tunnel through/i);
		expect(await readdir(directory)).toEqual([]);
	});

	it("#given no proxy env #when the direct download attempt fails #then the error does not mention proxies", async () => {
		// given
		const directory = createTemporaryDirectory("omo-bootstrap-download-");
		const fetchImpl: FetchLike = async () => {
			throw new Error("getaddrinfo ENOTFOUND example.invalid");
		};

		// when
		const failure = downloadChecksummedAsset({
			destination: join(directory, "asset.zip"),
			env: {},
			fetchImpl,
			sha256: sha256Hex(new Uint8Array()),
			url: "https://example.invalid/assets/asset.zip",
		});

		// then
		const error = (await failure.then(
			() => {
				throw new Error("expected downloadChecksummedAsset to reject");
			},
			(caught: unknown) => caught,
		)) as DownloadError;
		expect(error.code).toBe("download-failed");
		expect(error.message).not.toContain("HTTPS_PROXY");
	});
});

describe("downloadFromManifest", () => {
	it("#given a manifest with a platform entry #when downloading for that platform #then the asset lands under its URL basename in the destination dir", async () => {
		// given
		const directory = createTemporaryDirectory("omo-bootstrap-manifest-");
		const manifestsDir = join(directory, "manifests");
		const destinationDir = join(directory, "downloads");
		const payload = new TextEncoder().encode("tool binary zip bytes");
		await writeManifestFixture(manifestsDir, {
			"darwin-arm64": {
				sha256: sha256Hex(payload),
				url: "https://example.invalid/releases/tool-1.0.0-darwin-arm64.zip",
			},
		});
		const { calls, fetchImpl } = fetchReturning(payload);

		// when
		const destination = await downloadFromManifest({
			destinationDir,
			fetchImpl,
			manifestName: "tool",
			manifestsDir,
			platformKey: "darwin-arm64",
		});

		// then
		expect(destination).toBe(join(destinationDir, "tool-1.0.0-darwin-arm64.zip"));
		expect(calls).toEqual(["https://example.invalid/releases/tool-1.0.0-darwin-arm64.zip"]);
		expect(new Uint8Array(await readFile(destination))).toEqual(payload);
		expect(basename(destination)).toBe("tool-1.0.0-darwin-arm64.zip");
	});

	it("#given a manifest without the requested platform #when downloading #then a typed unsupported-platform error is thrown before any fetch", async () => {
		// given
		const directory = createTemporaryDirectory("omo-bootstrap-manifest-");
		const manifestsDir = join(directory, "manifests");
		await writeManifestFixture(manifestsDir, {
			"darwin-arm64": { sha256: sha256Hex(new Uint8Array()), url: "https://example.invalid/tool.zip" },
		});
		const { calls, fetchImpl } = fetchReturning(new Uint8Array());

		// when
		const failure = downloadFromManifest({
			destinationDir: join(directory, "downloads"),
			fetchImpl,
			manifestName: "tool",
			manifestsDir,
			platformKey: "linux-x64",
		});

		// then
		const error = (await failure.then(
			() => {
				throw new Error("expected downloadFromManifest to reject");
			},
			(caught: unknown) => caught,
		)) as UnsupportedPlatformError;
		expect(error).toBeInstanceOf(UnsupportedPlatformError);
		expect(error.code).toBe("unsupported-platform");
		expect(error.platformKey).toBe("linux-x64");
		expect(error.message).toContain('"linux-x64"');
		expect(error.message).toContain("darwin-arm64");
		expect(calls).toEqual([]);
	});
});

describe("committed manifests", () => {
	it("#given the committed ast-grep manifest #when loaded #then every required platform pins an https URL and a sha256", async () => {
		// given / when
		const manifest = await loadAssetManifest("ast-grep");

		// then
		expect(manifest.name).toBe("ast-grep");
		expect(manifest.version).toMatch(/^\d+\.\d+\.\d+$/);
		for (const platformKey of ["darwin-arm64", "darwin-x64", "linux-x64", "win32-x64"]) {
			const asset = manifest.platforms[platformKey];
			if (asset === undefined) throw new Error(`missing platform ${platformKey}`);
			expect(asset.url).toStartWith("https://");
			expect(asset.url).toContain(manifest.version);
			expect(asset.sha256).toMatch(/^[a-f0-9]{64}$/);
		}
	});

	it("#given the committed node manifest #when loaded #then the win32-x64 LTS zip pins an https URL and a sha256", async () => {
		// given / when
		const manifest = await loadAssetManifest("node");

		// then
		expect(manifest.name).toBe("node");
		expect(manifest.version).toMatch(/^\d+\.\d+\.\d+$/);
		const asset = manifest.platforms["win32-x64"];
		if (asset === undefined) throw new Error("missing platform win32-x64");
		expect(asset.url).toStartWith("https://nodejs.org/dist/");
		expect(asset.url).toEndWith("-win-x64.zip");
		expect(asset.url).toContain(manifest.version);
		expect(asset.sha256).toMatch(/^[a-f0-9]{64}$/);
	});
});
