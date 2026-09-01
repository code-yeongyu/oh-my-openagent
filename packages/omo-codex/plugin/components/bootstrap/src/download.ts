import { createHash, randomUUID } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdir, readFile, rename, rm } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream as NodeWebReadableStream } from "node:stream/web";
import { fileURLToPath } from "node:url";

export type DownloadErrorCode = "checksum-mismatch" | "download-failed" | "unsupported-platform";

export class DownloadError extends Error {
	readonly code: DownloadErrorCode;

	constructor(code: DownloadErrorCode, message: string) {
		super(message);
		this.name = "DownloadError";
		this.code = code;
	}
}

export class ChecksumMismatchError extends DownloadError {
	readonly expectedSha256: string;
	readonly actualSha256: string;

	constructor(options: { readonly url: string; readonly expectedSha256: string; readonly actualSha256: string }) {
		super(
			"checksum-mismatch",
			`Checksum mismatch for ${options.url}: expected sha256 ${options.expectedSha256} but downloaded sha256 ${options.actualSha256}; deleted the partial download.`,
		);
		this.name = "ChecksumMismatchError";
		this.expectedSha256 = options.expectedSha256;
		this.actualSha256 = options.actualSha256;
	}
}

export class UnsupportedPlatformError extends DownloadError {
	readonly manifestName: string;
	readonly platformKey: string;

	constructor(options: {
		readonly manifestName: string;
		readonly platformKey: string;
		readonly availablePlatforms: readonly string[];
	}) {
		super(
			"unsupported-platform",
			`Manifest "${options.manifestName}" has no asset for unsupported platform "${options.platformKey}" (available: ${options.availablePlatforms.join(", ")}).`,
		);
		this.name = "UnsupportedPlatformError";
		this.manifestName = options.manifestName;
		this.platformKey = options.platformKey;
	}
}

export type FetchLike = (url: string) => Promise<Response>;

export interface ManifestAsset {
	readonly url: string;
	readonly sha256: string;
}

export interface AssetManifest {
	readonly name: string;
	readonly version: string;
	readonly platforms: Readonly<Record<string, ManifestAsset>>;
}

export interface DownloadChecksummedAssetOptions {
	readonly url: string;
	readonly sha256: string;
	readonly destination: string;
	readonly fetchImpl?: FetchLike;
	readonly env?: NodeJS.ProcessEnv;
}

export interface DownloadFromManifestOptions {
	readonly manifestName: string;
	readonly platformKey: string;
	readonly destinationDir: string;
	readonly fetchImpl?: FetchLike;
	readonly env?: NodeJS.ProcessEnv;
	readonly manifestsDir?: string;
}

const PROXY_ENV_KEYS = ["HTTPS_PROXY", "https_proxy", "HTTP_PROXY", "http_proxy"] as const;

function proxyLimitationNote(env: NodeJS.ProcessEnv): string {
	const configuredKey = PROXY_ENV_KEYS.find((key) => (env[key] ?? "").trim().length > 0);
	if (configuredKey === undefined) return "";
	return ` Note: ${configuredKey} is set, but the bootstrap downloader does not tunnel through HTTP(S) proxies in v1; the download was attempted directly.`;
}

function describeFailure(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

async function writeBodyToFile(body: NodeWebReadableStream<Uint8Array> | null, tempPath: string): Promise<string> {
	const hash = createHash("sha256");
	if (body === null) {
		await pipeline(Readable.from([]), createWriteStream(tempPath));
		return hash.digest("hex");
	}
	await pipeline(
		Readable.fromWeb(body),
		async function* hashChunks(source: AsyncIterable<Uint8Array>): AsyncGenerator<Buffer> {
			for await (const chunk of source) {
				const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
				hash.update(buffer);
				yield buffer;
			}
		},
		createWriteStream(tempPath),
	);
	return hash.digest("hex");
}

export async function downloadChecksummedAsset(options: DownloadChecksummedAssetOptions): Promise<string> {
	const fetchImpl = options.fetchImpl ?? globalThis.fetch;
	const env = options.env ?? process.env;
	const expectedSha256 = options.sha256.toLowerCase();
	await mkdir(dirname(options.destination), { recursive: true });
	const tempPath = `${options.destination}.${randomUUID().slice(0, 8)}.partial`;

	let response: Response;
	try {
		response = await fetchImpl(options.url);
	} catch (error) {
		throw new DownloadError(
			"download-failed",
			`Download failed for ${options.url}: ${describeFailure(error)}.${proxyLimitationNote(env)}`,
		);
	}
	if (!response.ok) {
		throw new DownloadError(
			"download-failed",
			`Download failed for ${options.url}: HTTP ${response.status}.${proxyLimitationNote(env)}`,
		);
	}

	let actualSha256: string;
	try {
		actualSha256 = await writeBodyToFile(response.body as NodeWebReadableStream<Uint8Array> | null, tempPath);
	} catch (error) {
		await rm(tempPath, { force: true });
		throw new DownloadError(
			"download-failed",
			`Download failed for ${options.url} while writing the response body: ${describeFailure(error)}.${proxyLimitationNote(env)}`,
		);
	}

	if (actualSha256 !== expectedSha256) {
		await rm(tempPath, { force: true });
		throw new ChecksumMismatchError({ actualSha256, expectedSha256, url: options.url });
	}

	await rename(tempPath, options.destination);
	return options.destination;
}

export function resolveDefaultManifestsDir(): string {
	return join(dirname(fileURLToPath(import.meta.url)), "..", "manifests");
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseManifestAsset(value: unknown, manifestName: string, platformKey: string): ManifestAsset {
	if (!isRecord(value) || typeof value["url"] !== "string" || typeof value["sha256"] !== "string") {
		throw new Error(`Manifest "${manifestName}" platform "${platformKey}" must pin both url and sha256 strings.`);
	}
	return { sha256: value["sha256"], url: value["url"] };
}

export function parseAssetManifest(raw: string, manifestName: string): AssetManifest {
	const data: unknown = JSON.parse(raw);
	if (!isRecord(data) || typeof data["name"] !== "string" || typeof data["version"] !== "string" || !isRecord(data["platforms"])) {
		throw new Error(`Manifest "${manifestName}" must declare name, version, and a platforms object.`);
	}
	const platforms: Record<string, ManifestAsset> = {};
	for (const [platformKey, asset] of Object.entries(data["platforms"])) {
		platforms[platformKey] = parseManifestAsset(asset, manifestName, platformKey);
	}
	return { name: data["name"], platforms, version: data["version"] };
}

export async function loadAssetManifest(manifestName: string, manifestsDir?: string): Promise<AssetManifest> {
	const directory = manifestsDir ?? resolveDefaultManifestsDir();
	const raw = await readFile(join(directory, `${manifestName}.json`), "utf8");
	return parseAssetManifest(raw, manifestName);
}

export async function downloadFromManifest(options: DownloadFromManifestOptions): Promise<string> {
	const manifest = await loadAssetManifest(options.manifestName, options.manifestsDir);
	const asset = manifest.platforms[options.platformKey];
	if (asset === undefined) {
		throw new UnsupportedPlatformError({
			availablePlatforms: Object.keys(manifest.platforms),
			manifestName: options.manifestName,
			platformKey: options.platformKey,
		});
	}
	const destination = join(options.destinationDir, basename(new URL(asset.url).pathname));
	return downloadChecksummedAsset({
		destination,
		sha256: asset.sha256,
		url: asset.url,
		...(options.fetchImpl === undefined ? {} : { fetchImpl: options.fetchImpl }),
		...(options.env === undefined ? {} : { env: options.env }),
	});
}
