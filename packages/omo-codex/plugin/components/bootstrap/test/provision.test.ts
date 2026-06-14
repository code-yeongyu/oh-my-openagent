import { afterEach, describe, expect, it } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { deflateRawSync } from "node:zlib";

import type { FetchLike } from "../src/download.ts";
import {
	runSgProvision,
	SG_FORCE_PROVISION_ENV_KEY,
	SG_PROVISION_COMPONENT,
	sgProvisionDestination,
} from "../src/provision.ts";
import {
	BOOTSTRAP_DOCTOR_HINT,
	defaultWorkerSteps,
	readBootstrapState,
	runBootstrapWorker,
	type BootstrapWorkerContext,
} from "../src/worker.ts";

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

const CRC_TABLE = ((): Uint32Array => {
	const table = new Uint32Array(256);
	for (let index = 0; index < 256; index += 1) {
		let value = index;
		for (let bit = 0; bit < 8; bit += 1) {
			value = (value & 1) === 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
		}
		table[index] = value >>> 0;
	}
	return table;
})();

function crc32(bytes: Uint8Array): number {
	let crc = 0xffffffff;
	for (const byte of bytes) {
		crc = (CRC_TABLE[(crc ^ byte) & 0xff] as number) ^ (crc >>> 8);
	}
	return (crc ^ 0xffffffff) >>> 0;
}

/** Builds a real (deflate-compressed) zip archive, mirroring the ast-grep release asset layout. */
function makeZip(entries: ReadonlyArray<{ name: string; data: Uint8Array }>): Buffer {
	const locals: Buffer[] = [];
	const centrals: Buffer[] = [];
	let localOffset = 0;
	for (const entry of entries) {
		const name = Buffer.from(entry.name, "utf8");
		const compressed = deflateRawSync(entry.data);
		const checksum = crc32(entry.data);
		const local = Buffer.alloc(30 + name.length + compressed.length);
		local.writeUInt32LE(0x04034b50, 0);
		local.writeUInt16LE(20, 4);
		local.writeUInt16LE(8, 8);
		local.writeUInt32LE(checksum, 14);
		local.writeUInt32LE(compressed.length, 18);
		local.writeUInt32LE(entry.data.length, 22);
		local.writeUInt16LE(name.length, 26);
		name.copy(local, 30);
		compressed.copy(local, 30 + name.length);
		locals.push(local);

		const central = Buffer.alloc(46 + name.length);
		central.writeUInt32LE(0x02014b50, 0);
		central.writeUInt16LE(0x031e, 4);
		central.writeUInt16LE(20, 6);
		central.writeUInt16LE(8, 10);
		central.writeUInt32LE(checksum, 16);
		central.writeUInt32LE(compressed.length, 20);
		central.writeUInt32LE(entry.data.length, 24);
		central.writeUInt16LE(name.length, 28);
		central.writeUInt32LE((0o100755 << 16) >>> 0, 38);
		central.writeUInt32LE(localOffset, 42);
		name.copy(central, 46);
		centrals.push(central);
		localOffset += local.length;
	}
	const centralDirectory = Buffer.concat(centrals);
	const endRecord = Buffer.alloc(22);
	endRecord.writeUInt32LE(0x06054b50, 0);
	endRecord.writeUInt16LE(entries.length, 8);
	endRecord.writeUInt16LE(entries.length, 10);
	endRecord.writeUInt32LE(centralDirectory.length, 12);
	endRecord.writeUInt32LE(localOffset, 16);
	return Buffer.concat([...locals, centralDirectory, endRecord]);
}

// Real release zips ship a tiny PATH-searching `sg` alias shim plus the
// standalone `ast-grep` binary; provisioning must install the standalone one.
const STANDALONE_BYTES = new Uint8Array(Buffer.alloc(16_384, "standalone-ast-grep-binary "));
const SHIM_BYTES = new Uint8Array(Buffer.from("path-searching-sg-shim"));
const FIXTURE_ZIP = makeZip([
	{ data: SHIM_BYTES, name: "sg" },
	{ data: STANDALONE_BYTES, name: "ast-grep" },
]);
const FIXTURE_VERSION = "9.9.9";

async function writeAstGrepManifest(
	manifestsDir: string,
	options: { sha256?: string; platforms?: Record<string, { url: string; sha256: string }> } = {},
): Promise<void> {
	await mkdir(manifestsDir, { recursive: true });
	const platforms = options.platforms ?? {
		"linux-x64": {
			sha256: options.sha256 ?? sha256Hex(FIXTURE_ZIP),
			url: "https://example.invalid/releases/9.9.9/app-x86_64-unknown-linux-gnu.zip",
		},
	};
	const manifest = { name: "ast-grep", platforms, version: FIXTURE_VERSION };
	await writeFile(join(manifestsDir, "ast-grep.json"), JSON.stringify(manifest, null, "\t"), "utf8");
}

function fetchReturning(bytes: Uint8Array): { fetchImpl: FetchLike; calls: string[] } {
	const calls: string[] = [];
	const fetchImpl: FetchLike = async (url) => {
		calls.push(url);
		return new Response(bytes, { status: 200 });
	};
	return { calls, fetchImpl };
}

function makeContext(options: {
	codexHome: string;
	manifestDir: string;
	pluginData: string;
	env?: Record<string, string | undefined>;
}): BootstrapWorkerContext {
	return {
		codexHome: options.codexHome,
		env: options.env ?? {},
		flags: { manifestDir: options.manifestDir, once: false, only: "sg" },
		now: 1_700_000_000_000,
		platform: "linux",
		pluginData: options.pluginData,
		pluginRoot: join(options.pluginData, "plugin-root"),
		pluginVersion: "1.0.0",
	};
}

async function listFilesRecursively(root: string): Promise<string[]> {
	try {
		const entries = await readdir(root, { recursive: true, withFileTypes: true });
		return entries.filter((entry) => entry.isFile()).map((entry) => join(entry.parentPath, entry.name));
	} catch {
		return [];
	}
}

async function readBootstrapLog(pluginData: string): Promise<string> {
	try {
		return await readFile(join(pluginData, "bootstrap", "bootstrap.log"), "utf8");
	} catch {
		return "";
	}
}

describe("runSgProvision", () => {
	it("#given resolution misses #when provisioning from a pinned zip #then the standalone binary lands at the resolver probe path with mode 755 and no staging leftovers", async () => {
		// given
		const root = createTemporaryDirectory("omo-bootstrap-provision-");
		const codexHome = join(root, "codex-home");
		const manifestDir = join(root, "manifests");
		await writeAstGrepManifest(manifestDir);
		const { calls, fetchImpl } = fetchReturning(FIXTURE_ZIP);
		const probed: string[] = [];
		const context = makeContext({ codexHome, manifestDir, pluginData: join(root, "data") });

		// when
		const outcome = await runSgProvision(context, {
			arch: "x64",
			fetchImpl,
			resolvePreexistingSg: () => null,
			runVersionProbe: async (binaryPath: string) => {
				probed.push(binaryPath);
				return `ast-grep ${FIXTURE_VERSION}\n`;
			},
		});

		// then
		const destination = join(codexHome, "runtime", "ast-grep", "linux-x64", "sg");
		expect(sgProvisionDestination(context, "x64")).toBe(destination);
		expect(outcome.degraded).toEqual([]);
		expect(calls).toEqual(["https://example.invalid/releases/9.9.9/app-x86_64-unknown-linux-gnu.zip"]);
		expect(probed).toEqual([destination]);
		expect(new Uint8Array(await readFile(destination))).toEqual(STANDALONE_BYTES);
		expect((await stat(destination)).mode & 0o777).toBe(0o755);
		expect(await listFilesRecursively(join(codexHome, "runtime"))).toEqual([destination]);
		expect(await readBootstrapLog(context.pluginData)).toContain(`"sg":"provisioned:${destination}"`);
	});

	it("#given a preexisting sg resolution #when provisioning #then it short-circuits without fetching and records a preexisting note in the log", async () => {
		// given
		const root = createTemporaryDirectory("omo-bootstrap-provision-");
		const codexHome = join(root, "codex-home");
		const manifestDir = join(root, "manifests");
		await writeAstGrepManifest(manifestDir);
		const { calls, fetchImpl } = fetchReturning(FIXTURE_ZIP);
		const context = makeContext({ codexHome, manifestDir, pluginData: join(root, "data") });

		// when
		const outcome = await runSgProvision(context, {
			arch: "x64",
			fetchImpl,
			resolvePreexistingSg: () => "/opt/homebrew/bin/sg",
			runVersionProbe: async () => {
				throw new Error("must not probe on short-circuit");
			},
		});

		// then
		expect(outcome.degraded).toEqual([]);
		expect(calls).toEqual([]);
		expect(await listFilesRecursively(join(codexHome, "runtime"))).toEqual([]);
		expect(await readBootstrapLog(context.pluginData)).toContain('"sg":"preexisting:/opt/homebrew/bin/sg"');
	});

	it("#given OMO_BOOTSTRAP_FORCE_PROVISION=1 #when a preexisting sg would resolve #then resolution is bypassed and provisioning still runs", async () => {
		// given
		const root = createTemporaryDirectory("omo-bootstrap-provision-");
		const codexHome = join(root, "codex-home");
		const manifestDir = join(root, "manifests");
		await writeAstGrepManifest(manifestDir);
		const { calls, fetchImpl } = fetchReturning(FIXTURE_ZIP);
		const resolverCalls: string[] = [];
		const context = makeContext({
			codexHome,
			env: { [SG_FORCE_PROVISION_ENV_KEY]: "1" },
			manifestDir,
			pluginData: join(root, "data"),
		});

		// when
		const outcome = await runSgProvision(context, {
			arch: "x64",
			fetchImpl,
			resolvePreexistingSg: () => {
				resolverCalls.push("resolved");
				return "/opt/homebrew/bin/sg";
			},
			runVersionProbe: async () => `ast-grep ${FIXTURE_VERSION}`,
		});

		// then
		expect(outcome.degraded).toEqual([]);
		expect(resolverCalls).toEqual([]);
		expect(calls).toHaveLength(1);
		expect(await listFilesRecursively(join(codexHome, "runtime"))).toEqual([
			join(codexHome, "runtime", "ast-grep", "linux-x64", "sg"),
		]);
	});

	it("#given a tampered checksum #when provisioning #then a degraded ast_grep entry names the mismatch and no file is left under runtime", async () => {
		// given
		const root = createTemporaryDirectory("omo-bootstrap-provision-");
		const codexHome = join(root, "codex-home");
		const manifestDir = join(root, "manifests");
		await writeAstGrepManifest(manifestDir, { sha256: sha256Hex(new TextEncoder().encode("tampered")) });
		const context = makeContext({ codexHome, manifestDir, pluginData: join(root, "data") });

		// when
		const outcome = await runSgProvision(context, {
			arch: "x64",
			fetchImpl: fetchReturning(FIXTURE_ZIP).fetchImpl,
			resolvePreexistingSg: () => null,
			runVersionProbe: async () => `ast-grep ${FIXTURE_VERSION}`,
		});

		// then
		expect(outcome.degraded).toHaveLength(1);
		const entry = outcome.degraded[0];
		expect(entry?.component).toBe(SG_PROVISION_COMPONENT);
		expect(entry?.reason).toMatch(/checksum mismatch/i);
		expect(entry?.hint).toBe(BOOTSTRAP_DOCTOR_HINT);
		expect(await listFilesRecursively(join(codexHome, "runtime"))).toEqual([]);
	});

	it("#given a binary that reports the wrong version #when provisioning #then the provisioned file is removed and a degraded entry names both versions", async () => {
		// given
		const root = createTemporaryDirectory("omo-bootstrap-provision-");
		const codexHome = join(root, "codex-home");
		const manifestDir = join(root, "manifests");
		await writeAstGrepManifest(manifestDir);
		const context = makeContext({ codexHome, manifestDir, pluginData: join(root, "data") });

		// when
		const outcome = await runSgProvision(context, {
			arch: "x64",
			fetchImpl: fetchReturning(FIXTURE_ZIP).fetchImpl,
			resolvePreexistingSg: () => null,
			runVersionProbe: async () => "ast-grep 0.0.1",
		});

		// then
		expect(outcome.degraded).toHaveLength(1);
		const entry = outcome.degraded[0];
		expect(entry?.component).toBe(SG_PROVISION_COMPONENT);
		expect(entry?.reason).toContain("0.0.1");
		expect(entry?.reason).toContain(FIXTURE_VERSION);
		expect(entry?.hint).toBe(BOOTSTRAP_DOCTOR_HINT);
		expect(await listFilesRecursively(join(codexHome, "runtime"))).toEqual([]);
	});

	it("#given a platform absent from the manifest #when provisioning #then a degraded entry names the unsupported platform without fetching", async () => {
		// given
		const root = createTemporaryDirectory("omo-bootstrap-provision-");
		const codexHome = join(root, "codex-home");
		const manifestDir = join(root, "manifests");
		await writeAstGrepManifest(manifestDir);
		const { calls, fetchImpl } = fetchReturning(FIXTURE_ZIP);
		const context = makeContext({ codexHome, manifestDir, pluginData: join(root, "data") });

		// when
		const outcome = await runSgProvision(context, {
			arch: "riscv64",
			fetchImpl,
			resolvePreexistingSg: () => null,
			runVersionProbe: async () => `ast-grep ${FIXTURE_VERSION}`,
		});

		// then
		expect(outcome.degraded).toHaveLength(1);
		const entry = outcome.degraded[0];
		expect(entry?.component).toBe(SG_PROVISION_COMPONENT);
		expect(entry?.reason).toMatch(/unsupported platform/i);
		expect(entry?.reason).toContain("linux-riscv64");
		expect(calls).toEqual([]);
		expect(await listFilesRecursively(join(codexHome, "runtime"))).toEqual([]);
	});

	it("#given win32 #when provisioning #then the destination binary is sg.exe extracted from the .exe entry", async () => {
		// given
		const root = createTemporaryDirectory("omo-bootstrap-provision-");
		const codexHome = join(root, "codex-home");
		const manifestDir = join(root, "manifests");
		const windowsZip = makeZip([
			{ data: SHIM_BYTES, name: "sg.exe" },
			{ data: STANDALONE_BYTES, name: "ast-grep.exe" },
		]);
		await writeAstGrepManifest(manifestDir, {
			platforms: {
				"win32-x64": {
					sha256: sha256Hex(windowsZip),
					url: "https://example.invalid/releases/9.9.9/app-x86_64-pc-windows-msvc.zip",
				},
			},
		});
		const context: BootstrapWorkerContext = {
			...makeContext({ codexHome, manifestDir, pluginData: join(root, "data") }),
			platform: "win32",
		};

		// when
		const outcome = await runSgProvision(context, {
			arch: "x64",
			fetchImpl: fetchReturning(windowsZip).fetchImpl,
			resolvePreexistingSg: () => null,
			runVersionProbe: async () => `ast-grep ${FIXTURE_VERSION}`,
		});

		// then
		const destination = join(codexHome, "runtime", "ast-grep", "win32-x64", "sg.exe");
		expect(outcome.degraded).toEqual([]);
		expect(new Uint8Array(await readFile(destination))).toEqual(STANDALONE_BYTES);
	});
});

describe("worker sg step wiring", () => {
	it("#given --only sg with injected seams #when the worker runs #then the default sg step provisions through the manifest-dir flag and writes a success state", async () => {
		// given
		const root = createTemporaryDirectory("omo-bootstrap-provision-worker-");
		const codexHome = join(root, "codex-home");
		const manifestDir = join(root, "manifests");
		const pluginData = join(root, "data");
		const pluginRoot = join(root, "plugin-root");
		await writeAstGrepManifest(manifestDir);
		await mkdir(join(pluginRoot, ".codex-plugin"), { recursive: true });
		await writeFile(join(pluginRoot, ".codex-plugin", "plugin.json"), JSON.stringify({ version: "1.2.3" }), "utf8");
		const { calls, fetchImpl } = fetchReturning(FIXTURE_ZIP);

		// when
		const result = await runBootstrapWorker({
			argv: ["--only", "sg", "--codex-home", codexHome, "--manifest-dir", manifestDir],
			env: { PLUGIN_DATA: pluginData, PLUGIN_ROOT: pluginRoot },
			platform: "linux",
			steps: defaultWorkerSteps({
				sg: {
					arch: "x64",
					fetchImpl,
					resolvePreexistingSg: () => null,
					runVersionProbe: async () => `ast-grep ${FIXTURE_VERSION}`,
				},
			}),
		});

		// then
		expect(result.ran).toBe(true);
		if (!result.ran) throw new Error("expected the worker to run");
		expect(result.status).toBe("success");
		expect(calls).toHaveLength(1);
		const state = await readBootstrapState(join(pluginData, "bootstrap", "state.json"));
		expect(state.lastStatus).toBe("success");
		expect(state.degraded).toEqual([]);
		expect(await listFilesRecursively(join(codexHome, "runtime"))).toEqual([
			join(codexHome, "runtime", "ast-grep", "linux-x64", "sg"),
		]);
	});

	it("#given --only sg with a tampered manifest #when the worker runs #then it finishes degraded with an ast_grep checksum entry and exit-0 semantics", async () => {
		// given
		const root = createTemporaryDirectory("omo-bootstrap-provision-worker-");
		const codexHome = join(root, "codex-home");
		const manifestDir = join(root, "manifests");
		const pluginData = join(root, "data");
		const pluginRoot = join(root, "plugin-root");
		await writeAstGrepManifest(manifestDir, { sha256: sha256Hex(new TextEncoder().encode("tampered")) });
		await mkdir(join(pluginRoot, ".codex-plugin"), { recursive: true });
		await writeFile(join(pluginRoot, ".codex-plugin", "plugin.json"), JSON.stringify({ version: "1.2.3" }), "utf8");

		// when
		const result = await runBootstrapWorker({
			argv: ["--only", "sg", "--codex-home", codexHome, "--manifest-dir", manifestDir],
			env: { PLUGIN_DATA: pluginData, PLUGIN_ROOT: pluginRoot },
			platform: "linux",
			steps: defaultWorkerSteps({
				sg: {
					arch: "x64",
					fetchImpl: fetchReturning(FIXTURE_ZIP).fetchImpl,
					resolvePreexistingSg: () => null,
					runVersionProbe: async () => `ast-grep ${FIXTURE_VERSION}`,
				},
			}),
		});

		// then
		expect(result.ran).toBe(true);
		if (!result.ran) throw new Error("expected the worker to run");
		expect(result.status).toBe("degraded");
		const state = await readBootstrapState(join(pluginData, "bootstrap", "state.json"));
		expect(state.lastStatus).toBe("degraded");
		expect(state.degraded?.[0]?.component).toBe(SG_PROVISION_COMPONENT);
		expect(state.degraded?.[0]?.reason).toMatch(/checksum mismatch/i);
		expect(await listFilesRecursively(join(codexHome, "runtime"))).toEqual([]);
	});
});
