import { spawnSync } from "node:child_process";
import { accessSync, constants, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

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
}

export type DesktopEngineLocation =
	| { readonly path: string; readonly diagnostic: null }
	| { readonly path: null; readonly diagnostic: DesktopEngineLocateDiagnostic };

/** Reports whether a candidate carries macOS `com.apple.quarantine`; injectable for tests. */
export type DesktopEngineQuarantineProbe = (enginePath: string) => boolean;

export interface DesktopEngineLocatorOptions {
	readonly platform?: string;
	readonly arch?: string;
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

export function getDesktopEngineHost(platform: string = process.platform, arch: string = process.arch): string {
	return `${platform}-${arch}`;
}

export function getDesktopEngineFileName(platform: string = process.platform): string {
	return platform === "win32" ? `${DESKTOP_ENGINE_BINARY}.exe` : DESKTOP_ENGINE_BINARY;
}

/** OMO_PACKAGE_DIR (or its explicit override) precedes the sidecar, prebuild and dev build. */
export function getDesktopEngineCandidatePaths(options: DesktopEngineLocatorOptions = {}): readonly string[] {
	const host = getDesktopEngineHost(options.platform, options.arch);
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
	const host = getDesktopEngineHost(platform, options.arch);
	const attemptedPaths = getDesktopEngineCandidatePaths(options);
	const isQuarantined = options.isQuarantined ?? ((enginePath: string) => isQuarantinedFile(enginePath, platform));
	const causes: string[] = [];
	const quarantinedPaths: string[] = [];

	for (const enginePath of attemptedPaths) {
		if (!existsSync(enginePath)) {
			causes.push(`${enginePath}: missing`);
			continue;
		}
		// Spawning a quarantined, non-notarized binary hands control to Gatekeeper instead of
		// returning an error. Report it; never clear the attribute on the user's behalf.
		if (isQuarantined(enginePath)) {
			quarantinedPaths.push(enginePath);
			causes.push(`${enginePath}: blocked because ${QUARANTINE_ATTRIBUTE} is present (macOS Gatekeeper)`);
			continue;
		}
		if (!isExecutable(enginePath)) {
			causes.push(`${enginePath}: not executable (chmod +x)`);
			continue;
		}
		return { path: enginePath, diagnostic: null };
	}

	const code = quarantinedPaths.length > 0 ? "quarantined" : "native-unavailable";
	const message =
		code === "quarantined"
			? `The ${DESKTOP_ENGINE_BINARY} binary for ${host} is quarantined by macOS Gatekeeper: ${quarantinedPaths.join(", ")}.`
			: `No ${DESKTOP_ENGINE_BINARY} binary is available for ${host}.`;
	return { path: null, diagnostic: { code, host, attemptedPaths, message, cause: causes.join("; ") } };
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
