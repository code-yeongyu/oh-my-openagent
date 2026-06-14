import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { chmod, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { promisify } from "node:util";
import { inflateRawSync } from "node:zlib";

// Cross-package source import (bundled into dist/cli.js at build time) so the
// preexisting-sg probe order can never drift from the MCP's own resolver.
import { findSgCliPathSync } from "../../../../../ast-grep-mcp/src/sg-cli-path.ts";
import { downloadChecksummedAsset, loadAssetManifest } from "./download.ts";
import type { FetchLike } from "./download.ts";
import { appendBootstrapLog, BOOTSTRAP_DOCTOR_HINT } from "./worker.ts";
import type { BootstrapStepOutcome, BootstrapWorkerContext } from "./worker.ts";

export const SG_PROVISION_COMPONENT = "ast_grep";
export const SG_FORCE_PROVISION_ENV_KEY = "OMO_BOOTSTRAP_FORCE_PROVISION";
const SG_MANIFEST_NAME = "ast-grep";

export interface ResolvePreexistingSgOptions {
	readonly arch: string;
	readonly codexHome: string;
	readonly env: Record<string, string | undefined>;
	readonly platform: NodeJS.Platform;
}

export interface SgProvisionSeams {
	readonly arch?: string;
	readonly fetchImpl?: FetchLike;
	readonly resolvePreexistingSg?: (options: ResolvePreexistingSgOptions) => string | null;
	readonly runVersionProbe?: (binaryPath: string) => Promise<string>;
}

export function sgProvisionDestination(context: BootstrapWorkerContext, arch: string): string {
	const binaryName = context.platform === "win32" ? "sg.exe" : "sg";
	return join(context.codexHome, "runtime", "ast-grep", `${context.platform}-${arch}`, binaryName);
}

export async function runSgProvision(
	context: BootstrapWorkerContext,
	seams: SgProvisionSeams = {},
): Promise<BootstrapStepOutcome> {
	const arch = seams.arch ?? process.arch;
	const destination = sgProvisionDestination(context, arch);

	if (context.env[SG_FORCE_PROVISION_ENV_KEY] !== "1") {
		const preexisting = (seams.resolvePreexistingSg ?? defaultResolvePreexistingSg)({
			arch,
			codexHome: context.codexHome,
			env: context.env,
			platform: context.platform,
		});
		if (preexisting !== null) {
			await appendBootstrapLog(context.pluginData, context.now, "sg-provision", { sg: `preexisting:${preexisting}` });
			return { degraded: [] };
		}
	}

	const stagingDir = join(dirname(destination), `.staging-${randomUUID().slice(0, 8)}`);
	try {
		const version = await provisionFromManifest(context, seams, { arch, destination, stagingDir });
		await appendBootstrapLog(context.pluginData, context.now, "sg-provision", {
			sg: `provisioned:${destination}`,
			version,
		});
		return { degraded: [] };
	} catch (error) {
		const reason = error instanceof Error ? error.message : String(error);
		await appendBootstrapLog(context.pluginData, context.now, "sg-provision-failed", { reason });
		return { degraded: [{ component: SG_PROVISION_COMPONENT, hint: BOOTSTRAP_DOCTOR_HINT, reason }] };
	} finally {
		await rm(stagingDir, { force: true, recursive: true });
	}
}

async function provisionFromManifest(
	context: BootstrapWorkerContext,
	seams: SgProvisionSeams,
	layout: { readonly arch: string; readonly destination: string; readonly stagingDir: string },
): Promise<string> {
	const manifest = await loadAssetManifest(SG_MANIFEST_NAME, context.flags.manifestDir);
	const platformKey = `${context.platform}-${layout.arch}`;
	const asset = manifest.platforms[platformKey];
	if (asset === undefined) {
		throw new Error(
			`ast-grep ${manifest.version} has no asset for unsupported platform "${platformKey}" (available: ${Object.keys(manifest.platforms).join(", ")}).`,
		);
	}

	await mkdir(layout.stagingDir, { recursive: true });
	const archivePath = await downloadChecksummedAsset({
		destination: join(layout.stagingDir, basename(new URL(asset.url).pathname)),
		env: context.env as NodeJS.ProcessEnv,
		sha256: asset.sha256,
		url: asset.url,
		...(seams.fetchImpl === undefined ? {} : { fetchImpl: seams.fetchImpl }),
	});

	const binaryBytes = extractStandaloneSgBinary(await readFile(archivePath), context.platform);
	const stagedBinary = join(layout.stagingDir, basename(layout.destination));
	await writeFile(stagedBinary, binaryBytes);
	await chmod(stagedBinary, 0o755);
	await rename(stagedBinary, layout.destination);

	await verifyProvisionedVersion(layout.destination, manifest.version, seams);
	return manifest.version;
}

async function verifyProvisionedVersion(
	destination: string,
	pinnedVersion: string,
	seams: SgProvisionSeams,
): Promise<void> {
	let reported: string;
	try {
		reported = (await (seams.runVersionProbe ?? defaultVersionProbe)(destination)).trim();
	} catch (error) {
		await rm(destination, { force: true });
		throw new Error(
			`provisioned sg at ${destination} failed its --version probe: ${error instanceof Error ? error.message : String(error)}`,
		);
	}
	if (!reported.includes(pinnedVersion)) {
		await rm(destination, { force: true });
		throw new Error(
			`provisioned sg at ${destination} reported "${reported}" but the manifest pins version ${pinnedVersion}; removed the binary.`,
		);
	}
}

function defaultResolvePreexistingSg(options: ResolvePreexistingSgOptions): string | null {
	return findSgCliPathSync({
		arch: options.arch,
		env: { ...options.env, CODEX_HOME: options.codexHome },
		platform: options.platform,
	});
}

const execFileAsync = promisify(execFile);

async function defaultVersionProbe(binaryPath: string): Promise<string> {
	const { stdout } = await execFileAsync(binaryPath, ["--version"]);
	return String(stdout);
}

// Release zips (verified against 0.42.3) contain two entries: a tiny `sg`
// alias shim that exec's `ast-grep` via PATH search ONLY (it fails standalone
// even with a sibling ast-grep), and the standalone `ast-grep` binary. The
// standalone entry is therefore installed under the destination name sg[.exe].
function extractStandaloneSgBinary(zip: Buffer, platform: NodeJS.Platform): Buffer {
	const suffix = platform === "win32" ? ".exe" : "";
	const entries = listZipEntries(zip);
	const preferredNames = [`ast-grep${suffix}`, `sg${suffix}`];
	for (const preferred of preferredNames) {
		const entry = entries.find((candidate) => zipEntryBaseName(candidate.name) === preferred);
		if (entry !== undefined) return readZipEntryBytes(zip, entry);
	}
	throw new Error(
		`ast-grep release zip has no ${preferredNames.join(" or ")} entry (found: ${entries.map((entry) => entry.name).join(", ")}).`,
	);
}

function zipEntryBaseName(entryName: string): string {
	const segments = entryName.split("/");
	return segments[segments.length - 1] ?? entryName;
}

interface ZipCentralEntry {
	readonly compressedSize: number;
	readonly localHeaderOffset: number;
	readonly method: number;
	readonly name: string;
	readonly uncompressedSize: number;
}

// Minimal zip reader (EOCD -> central directory -> local header) so extraction
// stays pure-node and deterministic; offsets follow APPNOTE.TXT 4.3.
const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const LOCAL_SIGNATURE = 0x04034b50;
const ZIP64_SENTINEL = 0xffffffff;

function listZipEntries(zip: Buffer): ZipCentralEntry[] {
	const eocdOffset = findEndOfCentralDirectory(zip);
	const entryCount = zip.readUInt16LE(eocdOffset + 10);
	let cursor = zip.readUInt32LE(eocdOffset + 16);
	const entries: ZipCentralEntry[] = [];
	for (let index = 0; index < entryCount; index += 1) {
		if (cursor + 46 > zip.length || zip.readUInt32LE(cursor) !== CENTRAL_SIGNATURE) {
			throw new Error("zip central directory is corrupt (bad entry signature)");
		}
		const nameLength = zip.readUInt16LE(cursor + 28);
		const extraLength = zip.readUInt16LE(cursor + 30);
		const commentLength = zip.readUInt16LE(cursor + 32);
		entries.push({
			compressedSize: zip.readUInt32LE(cursor + 20),
			localHeaderOffset: zip.readUInt32LE(cursor + 42),
			method: zip.readUInt16LE(cursor + 10),
			name: zip.subarray(cursor + 46, cursor + 46 + nameLength).toString("utf8"),
			uncompressedSize: zip.readUInt32LE(cursor + 24),
		});
		cursor += 46 + nameLength + extraLength + commentLength;
	}
	return entries;
}

function findEndOfCentralDirectory(zip: Buffer): number {
	const lowestOffset = Math.max(0, zip.length - 22 - 65_535);
	for (let offset = zip.length - 22; offset >= lowestOffset; offset -= 1) {
		if (zip.readUInt32LE(offset) === EOCD_SIGNATURE) return offset;
	}
	throw new Error("downloaded asset is not a zip archive (end-of-central-directory record missing)");
}

function readZipEntryBytes(zip: Buffer, entry: ZipCentralEntry): Buffer {
	if (
		entry.compressedSize === ZIP64_SENTINEL ||
		entry.uncompressedSize === ZIP64_SENTINEL ||
		entry.localHeaderOffset === ZIP64_SENTINEL
	) {
		throw new Error(`zip entry ${entry.name} uses unsupported zip64 extensions`);
	}
	if (zip.readUInt32LE(entry.localHeaderOffset) !== LOCAL_SIGNATURE) {
		throw new Error(`zip entry ${entry.name} has a corrupt local header`);
	}
	const nameLength = zip.readUInt16LE(entry.localHeaderOffset + 26);
	const extraLength = zip.readUInt16LE(entry.localHeaderOffset + 28);
	const dataStart = entry.localHeaderOffset + 30 + nameLength + extraLength;
	const raw = zip.subarray(dataStart, dataStart + entry.compressedSize);
	const bytes = decompressZipEntry(raw, entry);
	if (bytes.length !== entry.uncompressedSize) {
		throw new Error(
			`zip entry ${entry.name} inflated to ${bytes.length} bytes but the archive declares ${entry.uncompressedSize}`,
		);
	}
	return bytes;
}

function decompressZipEntry(raw: Buffer, entry: ZipCentralEntry): Buffer {
	if (entry.method === 0) return Buffer.from(raw);
	if (entry.method === 8) return inflateRawSync(raw);
	throw new Error(`zip entry ${entry.name} uses unsupported compression method ${entry.method}`);
}
