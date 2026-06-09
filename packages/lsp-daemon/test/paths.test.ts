import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { daemonBaseDir, daemonPaths } from "../src/paths.js";

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
