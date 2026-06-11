import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

import { daemonBaseDir, daemonPaths, resolveDaemonVersion } from "../src/paths.js";

const stampScript = fileURLToPath(new URL("../scripts/stamp-dist-version.mjs", import.meta.url));
const packageManifest = JSON.parse(
	readFileSync(fileURLToPath(new URL("../package.json", import.meta.url)), "utf8"),
) as { name: string; version: string };

describe("daemon paths", () => {
	it("#given CODEX_LSP_DAEMON_DIR #when daemonBaseDir #then uses it verbatim", () => {
		expect(daemonBaseDir({ CODEX_LSP_DAEMON_DIR: "/custom/daemon" })).toBe("/custom/daemon");
	});

	it("#given PLUGIN_DATA #when daemonBaseDir #then nests under it", () => {
		expect(daemonBaseDir({ PLUGIN_DATA: "/data/codex-lsp" })).toBe(join("/data/codex-lsp", "daemon"));
	});

	it("#given CODEX_HOME #when daemonBaseDir #then nests under codex-lsp", () => {
		expect(daemonBaseDir({ CODEX_HOME: "/x/.codex" })).toBe(join("/x/.codex", "codex-lsp", "daemon"));
	});

	it("#given empty env #when daemonBaseDir #then defaults to home codex dir", () => {
		expect(daemonBaseDir({})).toBe(join(homedir(), ".codex", "codex-lsp", "daemon"));
	});

	it("#given version #when daemonPaths #then pins socket/lock/pid under versioned dir", () => {
		const paths = daemonPaths({ CODEX_LSP_DAEMON_DIR: "/d" }, "1.2.3");
		expect(paths.dir).toBe(join("/d", "v1.2.3"));
		if (process.platform === "win32") {
			expect(paths.socket.startsWith("\\\\.\\pipe\\omo-lsp-1.2.3-")).toBe(true);
		} else {
			expect(paths.socket).toBe(join("/d", "v1.2.3", "daemon.sock"));
		}
		expect(paths.lock).toBe(join("/d", "v1.2.3", "daemon.lock"));
		expect(paths.pid).toBe(join("/d", "v1.2.3", "daemon.pid"));
	});

	it("#given a very long base dir #when daemonPaths #then falls back to a short tmp socket", () => {
		const longDir = `/${"x".repeat(120)}`;
		const paths = daemonPaths({ CODEX_LSP_DAEMON_DIR: longDir }, "1.0.0");
		if (process.platform === "win32") {
			expect(paths.socket.startsWith("\\\\.\\pipe\\omo-lsp-1.0.0-")).toBe(true);
		} else {
			expect(paths.socket.startsWith(tmpdir())).toBe(true);
			expect(paths.socket.length).toBeLessThan(100);
		}
		expect(paths.lock).toBe(join(longDir, "v1.0.0", "daemon.lock"));
	});
});

describe("resolveDaemonVersion injection", () => {
	it("#given injected require returning a version for ./package.json #when resolving version #then returns the sibling-first result", () => {
		const fake = (id: string): unknown => {
			if (id === "./package.json") return { version: "9.9.9" };
			throw new Error("not found");
		};
		expect(resolveDaemonVersion(fake)).toBe("9.9.9");
	});

	it("#given injected require that throws for ./package.json but returns for ../package.json #when resolving version #then falls back to parent", () => {
		const fake = (id: string): unknown => {
			if (id === "../package.json") return { version: "8.8.8" };
			throw new Error("not found");
		};
		expect(resolveDaemonVersion(fake)).toBe("8.8.8");
	});

	it("#given injected require that throws for all candidates #when resolving version #then returns 0", () => {
		const fake = (_id: string): unknown => {
			throw new Error("not found");
		};
		expect(resolveDaemonVersion(fake)).toBe("0");
	});

	it("#given the default require #when resolving version #then returns the real package version", () => {
		const realVersion = packageManifest.version;
		expect(resolveDaemonVersion()).toBe(realVersion);
		expect(resolveDaemonVersion()).not.toBe("0");
	});
});

describe("stamp-dist-version script", () => {
	const tempDirs: string[] = [];

	afterEach(() => {
		for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
	});

	it("#given an existing dist dir #when running the stamp script #then writes a correct package.json", () => {
		const distDir = mkdtempSync(join(tmpdir(), "lsp-daemon-stamp-"));
		tempDirs.push(distDir);
		execFileSync(process.execPath, [stampScript, distDir]);
		const stamped = JSON.parse(readFileSync(join(distDir, "package.json"), "utf8")) as Record<string, unknown>;
		expect(stamped["name"]).toBe("@code-yeongyu/lsp-daemon");
		expect(stamped["version"]).toBe(packageManifest.version);
		expect(stamped["type"]).toBe("module");
		expect(stamped["private"]).toBe(true);
	});

	it("#given a missing dist dir #when running the stamp script #then exits with non-zero", () => {
		const baseDir = mkdtempSync(join(tmpdir(), "lsp-daemon-stamp-missing-"));
		tempDirs.push(baseDir);
		const missingDir = join(baseDir, "nonexistent");
		expect(() =>
			execFileSync(process.execPath, [stampScript, missingDir], { stdio: ["ignore", "ignore", "ignore"] }),
		).toThrow();
	});

	it("#given no dist dir argument #when running the stamp script with an existing dist #then writes correct package.json to the default dist", () => {
		const distDir = fileURLToPath(new URL("../dist", import.meta.url));
		mkdirSync(distDir, { recursive: true });
		execFileSync(process.execPath, [stampScript]);
		const stamped = JSON.parse(readFileSync(join(distDir, "package.json"), "utf8")) as Record<string, unknown>;
		expect(stamped["name"]).toBe("@code-yeongyu/lsp-daemon");
		expect(stamped["type"]).toBe("module");
	});
});
