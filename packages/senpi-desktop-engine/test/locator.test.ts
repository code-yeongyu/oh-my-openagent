import { createHash } from "node:crypto";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getDesktopEngineCandidatePaths, getDesktopEngineHost, libcFromSignals, locateDesktopEngine } from "../src/locator";

const platform = "darwin";
const arch = "arm64";
const host = "darwin-arm64";

let root: string;
let layout: {
	readonly execDir: string;
	readonly packageDir: string;
	readonly repoRoot: string;
	readonly runtimeDir: string;
	readonly extracted: string;
	readonly sidecar: string;
	readonly prebuild: string;
	readonly dev: string;
};

function placeEngine(enginePath: string, mode = 0o755): void {
	mkdirSync(path.dirname(enginePath), { recursive: true });
	writeFileSync(enginePath, "engine");
	chmodSync(enginePath, mode);
}

function locate(isQuarantined: (enginePath: string) => boolean = () => false) {
	const { execDir, packageDir, repoRoot } = layout;
	return locateDesktopEngine({ arch, execDir, isQuarantined, packageDir, platform, repoRoot, runtimeDir: "" });
}

beforeEach(() => {
	root = mkdtempSync(path.join(tmpdir(), "senpi-desktop-engine-locator-"));
	const execDir = path.join(root, "bin");
	const repoRoot = path.join(root, "repo");
	const packageDir = path.join(repoRoot, "packages", "desktop-engine");
	const runtimeDir = path.join(root, "extracted-runtime");
	layout = {
		execDir,
		packageDir,
		repoRoot,
		runtimeDir,
		extracted: path.join(runtimeDir, "native", "prebuilds", host, "senpi-desktop-engine"),
		sidecar: path.join(execDir, "native", "prebuilds", host, "senpi-desktop-engine"),
		prebuild: path.join(packageDir, "native", "prebuilds", host, "senpi-desktop-engine"),
		dev: path.join(repoRoot, "target", "release", "senpi-desktop-engine"),
	};
});

afterEach(() => {
	vi.unstubAllEnvs();
	rmSync(root, { force: true, recursive: true });
});

describe("locateDesktopEngine", () => {
	it.each(["linux", "win32"])("reports no release asset on an empty %s-arm64 installation", (platform) => {
		const result = locateDesktopEngine({
			platform, arch: "arm64", execDir: layout.execDir, packageDir: layout.packageDir,
			repoRoot: layout.repoRoot, runtimeDir: "", isQuarantined: () => false,
		});
		expect(result.diagnostic).toMatchObject({
			code: "native-unavailable", host: `${platform}-arm64`, reason: "no-release-asset",
		});
	});

	it("accepts a quarantined sidecar with matching installed checksums", () => {
		placeEngine(layout.sidecar);
		const digest = createHash("sha256").update("engine").digest("hex");
		writeFileSync(path.join(layout.execDir, "native", "prebuilds", "senpi-desktop-engine-checksums.txt"),
			`${digest}  senpi-desktop-engine-${host}\n`);

		const result = locate(() => true);

		expect(result).toEqual({ path: layout.sidecar, diagnostic: null });
	});

	it.each([
		undefined,
		`${"0".repeat(64)}  senpi-desktop-engine-${host}\n`,
		`${createHash("sha256").update("engine").digest("hex")} senpi-desktop-engine-${host}\n`,
		`${"0".repeat(64)}  unknown-engine\n`,
		`${"0".repeat(64)}  senpi-desktop-engine-linux-x64\n`,
		`${"0".repeat(64)}  senpi-desktop-engine-${host}\n${"0".repeat(64)}  senpi-desktop-engine-${host}\n`,
	])("refuses a quarantined sidecar with missing or invalid provenance (%s)", (manifest) => {
		placeEngine(layout.sidecar);
		if (manifest !== undefined) {
			writeFileSync(path.join(layout.execDir, "native", "prebuilds", "senpi-desktop-engine-checksums.txt"), manifest);
		}

		const result = locate(() => true);

		expect(result.path).toBeNull();
		expect(result.diagnostic?.code).toBe("quarantined");
	});

	it("refuses a quarantined sidecar whose native directory escapes the launcher", () => {
		const outside = path.join(root, "outside");
		placeEngine(path.join(outside, "prebuilds", host, "senpi-desktop-engine"));
		const digest = createHash("sha256").update("engine").digest("hex");
		writeFileSync(path.join(outside, "prebuilds", "senpi-desktop-engine-checksums.txt"),
			`${digest}  senpi-desktop-engine-${host}\n`);
		mkdirSync(layout.execDir, { recursive: true });
		symlinkSync(outside, path.join(layout.execDir, "native"), "junction");

		const result = locate(() => true);

		expect(result.path).toBeNull();
		expect(result.diagnostic?.code).toBe("quarantined");
	});

	it("uses OMO_PACKAGE_DIR before a compiled sidecar without an explicit runtime directory", () => {
		vi.stubEnv("OMO_PACKAGE_DIR", layout.runtimeDir);
		placeEngine(layout.extracted);
		placeEngine(layout.sidecar);

		expect(locateDesktopEngine({
			arch, execDir: layout.execDir, packageDir: layout.packageDir,
			platform, repoRoot: layout.repoRoot, isQuarantined: () => false,
		})).toEqual({ path: layout.extracted, diagnostic: null });
	});

	it("prefers the extracted compiled payload before the executable sidecar", () => {
		placeEngine(layout.extracted);
		placeEngine(layout.sidecar);
		placeEngine(layout.prebuild);

		expect(locateDesktopEngine({
			arch, execDir: layout.execDir, packageDir: layout.packageDir,
			platform, repoRoot: layout.repoRoot, runtimeDir: layout.runtimeDir,
			isQuarantined: () => false,
		})).toEqual({ path: layout.extracted, diagnostic: null });
	});

	it("prefers the compiled sidecar over the package prebuild and the dev build", () => {
		placeEngine(layout.sidecar);
		placeEngine(layout.prebuild);
		placeEngine(layout.dev);

		expect(locate()).toEqual({ path: layout.sidecar, diagnostic: null });
	});

	it("falls back to the vendored package prebuild when no sidecar exists", () => {
		placeEngine(layout.prebuild);
		placeEngine(layout.dev);

		expect(locate()).toEqual({ path: layout.prebuild, diagnostic: null });
	});

	it("falls back to the dev target/release build when nothing is vendored", () => {
		placeEngine(layout.dev);

		expect(locate()).toEqual({ path: layout.dev, diagnostic: null });
	});

	it("returns native-unavailable naming every attempted path when every candidate is missing", () => {
		const result = locate();

		expect(result.path).toBeNull();
		expect(result.diagnostic?.code).toBe("native-unavailable");
		expect(result.diagnostic?.host).toBe(host);
		expect(result.diagnostic?.attemptedPaths).toEqual([layout.sidecar, layout.prebuild, layout.dev]);
	});

	it("returns quarantined without clearing the attribute when the only engine is quarantined", () => {
		placeEngine(layout.prebuild);
		const probed: string[] = [];

		const result = locate((enginePath) => {
			probed.push(enginePath);
			return enginePath === layout.prebuild;
		});

		expect(result.path).toBeNull();
		expect(result.diagnostic?.code).toBe("quarantined");
		expect(result.diagnostic?.cause).toContain(`${layout.prebuild}: blocked because com.apple.quarantine is present`);
		expect(probed).toEqual([layout.prebuild]);
	});

	it("skips a quarantined candidate when a later candidate is clean", () => {
		placeEngine(layout.sidecar);
		placeEngine(layout.dev);

		expect(locate((enginePath) => enginePath === layout.sidecar)).toEqual({ path: layout.dev, diagnostic: null });
	});

	it("skips a candidate that lacks the executable bit", () => {
		placeEngine(layout.prebuild, 0o644);
		placeEngine(layout.dev);

		// Windows has no executable bit: X_OK degrades to an existence check there.
		const expected = process.platform === "win32" ? layout.prebuild : layout.dev;
		expect(locate().path).toBe(expected);
	});
});

describe("getDesktopEngineCandidatePaths", () => {
	it("names the .exe binary under the win32 host directory", () => {
		const paths = getDesktopEngineCandidatePaths({
			arch: "x64",
			execDir: layout.execDir,
			packageDir: layout.packageDir,
			platform: "win32",
			repoRoot: layout.repoRoot,
			runtimeDir: "",
		});

		expect(paths).toEqual([
			path.join(layout.execDir, "native", "prebuilds", "win32-x64", "senpi-desktop-engine.exe"),
			path.join(layout.packageDir, "native", "prebuilds", "win32-x64", "senpi-desktop-engine.exe"),
			path.join(layout.repoRoot, "target", "release", "senpi-desktop-engine.exe"),
		]);
	});
});

describe("getDesktopEngineHost", () => {
	it("names the libc on Linux so a musl host never resolves to the glibc engine", () => {
		expect(getDesktopEngineHost("linux", "x64", "glibc")).toBe("linux-x64");
		expect(getDesktopEngineHost("linux", "arm64", "glibc")).toBe("linux-arm64");
		expect(getDesktopEngineHost("linux", "x64", "musl")).toBe("linux-x64-musl");
		expect(getDesktopEngineHost("linux", "arm64", "musl")).toBe("linux-arm64-musl");
	});

	it("leaves non-Linux hosts unchanged whatever libc is passed", () => {
		expect(getDesktopEngineHost("darwin", "arm64", "musl")).toBe("darwin-arm64");
		expect(getDesktopEngineHost("win32", "x64", "musl")).toBe("win32-x64");
		expect(getDesktopEngineHost("darwin", "x64")).toBe("darwin-x64");
	});

	it("does not apply this process's libc to a platform it is not running on", () => {
		const foreign = process.platform === "linux" ? "darwin" : "linux";

		expect(getDesktopEngineHost(foreign, "x64")).toBe(`${foreign}-x64`);
	});
});

describe("getDesktopEngineCandidatePaths on musl", () => {
	it("searches the musl prebuild directory", () => {
		const paths = getDesktopEngineCandidatePaths({
			arch: "arm64",
			execDir: layout.execDir,
			libc: "musl",
			packageDir: layout.packageDir,
			platform: "linux",
			repoRoot: layout.repoRoot,
			runtimeDir: "",
		});

		expect(paths).toEqual([
			path.join(layout.execDir, "native", "prebuilds", "linux-arm64-musl", "senpi-desktop-engine"),
			path.join(layout.packageDir, "native", "prebuilds", "linux-arm64-musl", "senpi-desktop-engine"),
			path.join(layout.repoRoot, "target", "release", "senpi-desktop-engine"),
		]);
	});
});

describe("libcFromSignals", () => {
	const glibcReport = { header: { glibcVersionRuntime: "2.41" } };
	const muslReport = { header: { osName: "Linux" } };
	const muslMaps = "7f0000-7f1000 r-xp 00000000 00:2a 123 /lib/ld-musl-aarch64.so.1\n";
	const glibcMaps = "7f0000-7f1000 r-xp 00000000 00:2a 123 /usr/lib/aarch64-linux-gnu/libc.so.6\n";

	it("reads glibc from the runtime glibc version the report carries, even with musl installed", () => {
		expect(libcFromSignals(glibcReport, () => muslMaps)).toBe("glibc");
	});

	it("reads musl when the report omits glibc and the musl loader is mapped into the process", () => {
		expect(libcFromSignals(muslReport, () => muslMaps)).toBe("musl");
	});

	it("keeps glibc when neither signal proves musl", () => {
		expect(libcFromSignals(muslReport, () => glibcMaps)).toBe("glibc");
		expect(libcFromSignals(undefined, () => undefined)).toBe("glibc");
	});
});
