import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, posix, win32 } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
	InvalidRuntimeOverrideError,
	OMO_LSP_DAEMON_CLI,
	resolveDaemonCliPath,
	resolveDaemonRuntime,
} from "../src/ensure-daemon.js";
import {
	type DaemonPlatform,
	daemonBaseDir,
	daemonPaths,
	InvalidDaemonDirectoryError,
	InvalidDaemonVersionError,
	OMO_LSP_DAEMON_DIR,
	OMO_LSP_DAEMON_VERSION,
	validateDaemonVersion,
} from "../src/paths.js";

const DEFAULT_RUNTIME = { cliPath: "/packaged/cli.js", version: "1.2.3" } as const;

function unixPlatform(home: string = "/Users/qa", temp: string = "/tmp"): DaemonPlatform {
	return {
		platform: "linux",
		homedir: () => home,
		tmpdir: () => temp,
		getuid: () => 501,
		username: () => "qa-user",
		path: posix,
	};
}

function windowsPlatform(username: string = "qa-user"): DaemonPlatform {
	return {
		platform: "win32",
		homedir: () => "C:\\Users\\qa",
		tmpdir: () => "C:\\Temp",
		getuid: () => undefined,
		username: () => username,
		path: win32,
	};
}

describe("OMO daemon environment contract", () => {
	it("#given the public environment names #when enumerated #then exactly the three approved OMO variables exist", () => {
		expect([OMO_LSP_DAEMON_DIR, OMO_LSP_DAEMON_CLI, OMO_LSP_DAEMON_VERSION].sort()).toEqual([
			"OMO_LSP_DAEMON_CLI",
			"OMO_LSP_DAEMON_DIR",
			"OMO_LSP_DAEMON_VERSION",
		]);
	});

	it("#given harness-specific homes and synthetic legacy values #when resolving the default base #then only the user home influences it", () => {
		// given
		const legacyDirName = ["CODEX", "LSP", "DAEMON", "DIR"].join("_");
		const env = { CODEX_HOME: "/ignored/codex", PLUGIN_DATA: "/ignored/plugin", [legacyDirName]: "/ignored/legacy" };

		// when
		const base = daemonBaseDir(env, unixPlatform("/Users/qa"));

		// then
		expect(base).toBe("/Users/qa/.omo/lsp-daemon");
	});

	it("#given an absolute directory override with parent segments #when resolving the base #then it is normalized", () => {
		expect(daemonBaseDir({ [OMO_LSP_DAEMON_DIR]: "/tmp/omo/../shared" }, unixPlatform())).toBe("/tmp/shared");
	});

	it("#given a relative directory override #when resolving the base #then it is rejected", () => {
		expect(() => daemonBaseDir({ [OMO_LSP_DAEMON_DIR]: "relative/state" }, unixPlatform())).toThrow(
			InvalidDaemonDirectoryError,
		);
	});
});

describe("daemon version grammar", () => {
	it.each([
		"0",
		"1.2.3",
		"release_2026-07+build.5",
		"A",
	])("#given valid version %s #when validating #then it is preserved", (version) => {
		expect(validateDaemonVersion(version)).toBe(version);
	});

	it.each([
		"",
		" 1.2.3",
		"1.2.3 ",
		"../1",
		".hidden",
		"a/b",
		"a\\b",
		"a".repeat(129),
	])("#given invalid version %s #when validating #then it is rejected", (version) => {
		expect(() => validateDaemonVersion(version)).toThrow(InvalidDaemonVersionError);
	});
});

describe("daemon path derivation", () => {
	it("#given a valid runtime #when deriving paths #then every artifact is isolated under v<version>", () => {
		const paths = daemonPaths({ [OMO_LSP_DAEMON_DIR]: "/var/omo" }, DEFAULT_RUNTIME, unixPlatform());
		expect(paths.version).toBe("1.2.3");
		expect(paths.dir).toBe("/var/omo/v1.2.3");
		expect(paths.socket).toBe("/var/omo/v1.2.3/daemon.sock");
		expect(paths.cliPath).toBe(DEFAULT_RUNTIME.cliPath);
	});

		it("#given a long Unix version directory #when deriving the socket #then the historical short hash fallback remains", () => {
			const base = `/${"x".repeat(140)}`;
			const paths = daemonPaths({ [OMO_LSP_DAEMON_DIR]: base }, DEFAULT_RUNTIME, unixPlatform());
			expect(paths.socket).toBe("/tmp/omo-lsp-1.2.3-b174cf2e082d87e3/daemon.sock");
			expect(paths.socket.length).toBeLessThan(100);
		});

	it("#given deterministic Windows identity helpers #when deriving the pipe #then the digest binds version directory and user", () => {
		const env = { [OMO_LSP_DAEMON_DIR]: "C:\\omo\\daemon" };
		const first = daemonPaths(env, DEFAULT_RUNTIME, windowsPlatform());
		const second = daemonPaths(env, DEFAULT_RUNTIME, windowsPlatform("other-user"));
		expect(first.socket).toBe("\\\\.\\pipe\\omo-lsp-1.2.3-62c673605928ff0f");
		expect(second.socket).not.toBe(first.socket);
	});
});

describe("paired daemon runtime overrides", () => {
	const tempDirs: string[] = [];

	afterEach(() => {
		for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
	});

	function createCliFixture(kind: "file" | "directory" = "file"): string {
		const root = mkdtempSync(join(tmpdir(), "lsp-runtime-contract-"));
		tempDirs.push(root);
		const target = join(root, "cli.js");
		if (kind === "file") writeFileSync(target, "#!/usr/bin/env node\n");
		else mkdirSync(target);
		return target;
	}

	it("#given neither override #when resolving runtime #then packaged CLI and stamped version are preserved", () => {
		expect(resolveDaemonRuntime({}, DEFAULT_RUNTIME)).toEqual(DEFAULT_RUNTIME);
	});

	it("#given both overrides #when resolving runtime #then the explicit pair is preserved", () => {
		const cliPath = createCliFixture();
		expect(
			resolveDaemonRuntime({ [OMO_LSP_DAEMON_CLI]: cliPath, [OMO_LSP_DAEMON_VERSION]: "9.8.7+qa" }, DEFAULT_RUNTIME),
		).toEqual({ cliPath, version: "9.8.7+qa" });
	});

	it.each([
		{ name: "CLI only", env: { [OMO_LSP_DAEMON_CLI]: "/tmp/cli.js" } },
		{ name: "version only", env: { [OMO_LSP_DAEMON_VERSION]: "9.8.7" } },
	])("#given $name #when resolving runtime #then invalid_runtime_override is thrown", ({ env }) => {
		try {
			resolveDaemonRuntime(env, DEFAULT_RUNTIME);
			throw new Error("expected singleton override to fail");
		} catch (error) {
			expect(error).toBeInstanceOf(InvalidRuntimeOverrideError);
			if (error instanceof InvalidRuntimeOverrideError) expect(error.code).toBe("invalid_runtime_override");
		}
	});

	it.each([
		{ name: "relative", makePath: () => "relative/cli.js" },
		{ name: "missing", makePath: () => join(tmpdir(), "missing-omo-lsp-cli.js") },
		{ name: "directory", makePath: () => createCliFixture("directory") },
	])("#given a $name CLI override #when resolving runtime #then it is rejected", ({ makePath }) => {
		expect(() =>
			resolveDaemonRuntime({ [OMO_LSP_DAEMON_CLI]: makePath(), [OMO_LSP_DAEMON_VERSION]: "1.2.3" }, DEFAULT_RUNTIME),
		).toThrow(InvalidRuntimeOverrideError);
	});

	it("#given a singleton pair and relative base #when deriving paths #then pair validation wins before directory lookup", () => {
		const cliPath = createCliFixture();
		expect(() =>
			daemonPaths(
				{ [OMO_LSP_DAEMON_CLI]: cliPath, [OMO_LSP_DAEMON_DIR]: "relative/state" },
				DEFAULT_RUNTIME,
				unixPlatform(),
			),
		).toThrow(InvalidRuntimeOverrideError);
	});

	it("#given the shared resolver #when resolving only the CLI path #then singleton validation still applies", () => {
		expect(() => resolveDaemonCliPath({ [OMO_LSP_DAEMON_VERSION]: "1.2.3" }, DEFAULT_RUNTIME)).toThrow(
			InvalidRuntimeOverrideError,
		);
	});
});
