import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

import { resolveDaemonVersion } from "../src/paths.js";

const stampScript = fileURLToPath(new URL("../scripts/stamp-dist-version.mjs", import.meta.url));
const packageManifest = JSON.parse(
	readFileSync(fileURLToPath(new URL("../package.json", import.meta.url)), "utf8"),
) as { name: string; version: string };

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

	it.each([
		"",
		"../bad",
		"bad version",
		"a".repeat(129),
	])("#given invalid stamped package version %s #when resolving version #then it is rejected instead of downgraded to zero", (version) => {
		expect(() => resolveDaemonVersion(() => ({ version }))).toThrow();
	});

	it("#given the default require #when resolving version #then returns the real package version", () => {
		expect(resolveDaemonVersion()).toBe(packageManifest.version);
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
