import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { accessSync, constants, existsSync, readFileSync, realpathSync } from "node:fs";
import { dirname, join, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { parseDesktopEngineChecksums } from "./checksums";
import { DESKTOP_ENGINE_CHECKSUMS_ASSET, desktopEngineReleaseAssetName } from "./release-assets";

export const DESKTOP_ENGINE_BINARY = "senpi-desktop-engine";
export const QUARANTINE_ATTRIBUTE = "com.apple.quarantine";

/** `quarantined` wins over `native-unavailable`: it names the one fix the user can apply. */
export type DesktopEngineLocateDiagnosticCode = "native-unavailable" | "quarantined";

export interface DesktopEngineLocateDiagnostic {
	readonly code: DesktopEngineLocateDiagnosticCode;
	readonly host: string;
	readonly attemptedPaths: readonly string[];
	readonly message: string;
	readonly cause: string;
	readonly reason?: "no-release-asset";
}

export type DesktopEngineLocation =
	| { readonly path: string; readonly diagnostic: null }
	| { readonly path: null; readonly diagnostic: DesktopEngineLocateDiagnostic };

/** Reports whether a candidate carries macOS `com.apple.quarantine`; injectable for tests. */
export type DesktopEngineQuarantineProbe = (enginePath: string) => boolean;

/** The C library a Linux engine binary links against; other platforms ship one engine per architecture. */
export type DesktopEngineLibc = "glibc" | "musl";

export interface DesktopEngineLocatorOptions {
	readonly platform?: string;
	readonly arch?: string;
	/** Defaults to the running process's libc when `platform` is this Linux process's platform. */
	readonly libc?: DesktopEngineLibc;
	/** Overrides the OMO_PACKAGE_DIR extracted payload root (empty string disables it). */
	readonly runtimeDir?: string;
	/** Directory of the running executable; a compiled senpi ships the engine as a sidecar beside it. */
	readonly execDir?: string;
	/** Root of this package, which holds `native/prebuilds/<host>/`. */
	readonly packageDir?: string;
	/** Repository root whose `target/release/` holds a dev build. */
	readonly repoRoot?: string;
	readonly isQuarantined?: DesktopEngineQuarantineProbe;
}

const defaultPackageDir = join(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * `<platform>-<arch>`, plus `-musl` for a musl Linux host: the glibc engine cannot execute there.
 * The libc defaults to the running process's only when `platform` is the platform it runs on.
 */
export function getDesktopEngineHost(
	platform: string = process.platform,
	arch: string = process.arch,
	libc: DesktopEngineLibc | undefined = platform === "linux" && platform === process.platform ? runningLibc() : undefined,
): string {
	return platform === "linux" && libc === "musl" ? `${platform}-${arch}-musl` : `${platform}-${arch}`;
}

let detectedLibc: DesktopEngineLibc | undefined;

function runningLibc(): DesktopEngineLibc {
	detectedLibc ??= libcFromSignals(process.report?.getReport(), readProcessMaps);
	return detectedLibc;
}

/**
 * The libc of the running process, never of what is installed (a glibc host with musl-tools still
 * runs glibc). Glibc builds of Bun and Node report `header.glibcVersionRuntime`; musl builds omit it.
 * Absence alone does not prove musl, so musl also needs its loader mapped into this process; without
 * that evidence the host stays glibc, the name it had before libc was part of it.
 */
export function libcFromSignals(report: unknown, readMaps: () => string | undefined): DesktopEngineLibc {
	const header: unknown = typeof report === "object" && report !== null ? Reflect.get(report, "header") : undefined;
	const glibc: unknown = typeof header === "object" && header !== null ? Reflect.get(header, "glibcVersionRuntime") : undefined;
	if (typeof glibc === "string" && glibc.length > 0) return "glibc";
	return /\/ld-musl-[^/\s]+\.so\.1$/m.test(readMaps() ?? "") ? "musl" : "glibc";
}

function readProcessMaps(): string | undefined {
	try {
		return readFileSync("/proc/self/maps", "utf8");
	} catch (error) {
		if (error instanceof Error && "code" in error) return undefined;
		throw error;
	}
}

export function getDesktopEngineFileName(platform: string = process.platform): string {
	return platform === "win32" ? `${DESKTOP_ENGINE_BINARY}.exe` : DESKTOP_ENGINE_BINARY;
}

/** OMO_PACKAGE_DIR (or its explicit override) precedes the sidecar, prebuild and dev build. */
export function getDesktopEngineCandidatePaths(options: DesktopEngineLocatorOptions = {}): readonly string[] {
	const host = getDesktopEngineHost(options.platform, options.arch, options.libc);
	const file = getDesktopEngineFileName(options.platform);
	const packageDir = options.packageDir ?? defaultPackageDir;
	const execDir = options.execDir ?? dirname(process.execPath);
	const repoRoot = options.repoRoot ?? join(packageDir, "..", "..");
	const prebuild = join("native", "prebuilds", host, file);
	const runtimeDir = options.runtimeDir ?? process.env.OMO_PACKAGE_DIR;
	return [
		...(runtimeDir ? [join(runtimeDir, prebuild)] : []),
		join(execDir, prebuild),
		join(packageDir, prebuild),
		join(repoRoot, "target", "release", file),
	];
}

export function locateDesktopEngine(options: DesktopEngineLocatorOptions = {}): DesktopEngineLocation {
	const platform = options.platform ?? process.platform;
	const host = getDesktopEngineHost(platform, options.arch, options.libc);
	const attemptedPaths = getDesktopEngineCandidatePaths(options);
	const execDir = options.execDir ?? dirname(process.execPath);
	const sidecarIndex = (options.runtimeDir ?? process.env.OMO_PACKAGE_DIR) ? 1 : 0;
	const isQuarantined = options.isQuarantined ?? ((enginePath: string) => isQuarantinedFile(enginePath, platform));
	const causes: string[] = [];
	const quarantinedPaths: string[] = [];

	for (const [index, enginePath] of attemptedPaths.entries()) {
		if (!existsSync(enginePath)) {
			causes.push(`${enginePath}: missing`);
			continue;
		}
		// Spawning a quarantined, non-notarized binary hands control to Gatekeeper instead of
		// returning an error. Report it; never clear the attribute on the user's behalf.
		if (isQuarantined(enginePath)) {
			if (index !== sidecarIndex || !verifiedInstalledSidecar(enginePath, execDir, host)) {
				quarantinedPaths.push(enginePath);
				causes.push(`${enginePath}: blocked because ${QUARANTINE_ATTRIBUTE} is present (macOS Gatekeeper)`);
				continue;
			}
			causes.push(`${enginePath}: quarantined; accepted: inside the launcher's install and matching native/prebuilds/senpi-desktop-engine-checksums.txt`);
		}
		if (!isExecutable(enginePath)) {
			causes.push(`${enginePath}: not executable (chmod +x)`);
			continue;
		}
		return { path: enginePath, diagnostic: null };
	}

	const code = quarantinedPaths.length > 0 ? "quarantined" : "native-unavailable";
	const reason = causes.every((cause) => cause.endsWith(": missing")) && desktopEngineReleaseAssetName(host) === null
		? "no-release-asset" : undefined;
	const message =
		code === "quarantined"
			? `The ${DESKTOP_ENGINE_BINARY} binary for ${host} is quarantined by macOS Gatekeeper: ${quarantinedPaths.join(", ")}.`
			: reason === "no-release-asset"
				? `No senpi-desktop-engine is built for ${host}; computer use is unavailable on this host.`
				: `No ${DESKTOP_ENGINE_BINARY} binary is available for ${host}.`;
	return { path: null, diagnostic: { code, host, attemptedPaths, message, cause: causes.join("; "), ...(reason === undefined ? {} : { reason }) } };
}

/**
 * The sidecar belongs to the installed artifact Gatekeeper evaluated when the launcher was approved.
 * The omo release pipeline Developer-ID-signs and notarizes it (publish-platform.yml); the launcher's
 * build writes these checksums for the engine bytes as shipped, including any packaging re-sign.
 */
function verifiedInstalledSidecar(enginePath: string, execDir: string, host: string): boolean {
	try {
		const prefix = `${join(realpathSync(execDir), "native", "prebuilds")}${sep}`;
		if (!realpathSync(enginePath).startsWith(prefix)) return false;
		const asset = desktopEngineReleaseAssetName(host);
		if (asset === null) return false;
		const parsed = parseDesktopEngineChecksums(readFileSync(join(execDir, "native", "prebuilds", DESKTOP_ENGINE_CHECKSUMS_ASSET), "utf8"));
		if (parsed.error !== null) return false;
		const expected = parsed.checksums.get(asset);
		return expected !== undefined
			&& createHash("sha256").update(readFileSync(enginePath)).digest("hex") === expected.toLowerCase();
	} catch (error) {
		if (error instanceof Error && "code" in error) return false;
		throw error;
	}
}

/**
 * Node exposes no `getxattr`, so `xattr -p` is the only channel; it exits 0 only when the
 * attribute is present. A failed probe returns `false`: an unreadable attribute never rejects.
 */
export function isQuarantinedFile(enginePath: string, platform: string = process.platform): boolean {
	if (platform !== "darwin") return false;
	const probe = spawnSync("/usr/bin/xattr", ["-p", QUARANTINE_ATTRIBUTE, enginePath], {
		stdio: ["ignore", "ignore", "ignore"],
		timeout: 2000,
	});
	return probe.error === undefined && probe.status === 0;
}

function isExecutable(enginePath: string): boolean {
	try {
		accessSync(enginePath, constants.X_OK);
		return true;
	} catch (error) {
		if (error instanceof Error && "code" in error) return false;
		throw error;
	}
}
