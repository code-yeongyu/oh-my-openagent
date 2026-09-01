import {
	chmodSync,
	existsSync,
	lstatSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	realpathSync,
	rmSync,
	statSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { connect } from "node:net";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { callToolViaDaemon } from "../src/daemon-client.js";
import { DaemonAlreadyRunningError, DaemonStartupDeferredError, startDaemonServer } from "../src/daemon-server.js";
import { probeDaemon } from "../src/ensure-daemon.js";
import { ensurePrivateDirectory } from "../src/ipc-protocol.js";
import { readDaemonOwner, removeDaemonMetadataForOwner } from "../src/ownership.js";
import { type DaemonPaths, daemonPaths, OMO_LSP_DAEMON_DIR } from "../src/paths.js";
import { createLineDecoder, encodeJsonLine } from "../src/socket-jsonrpc.js";
import { daemonTestPaths } from "./daemon-path-fixture.js";

const tempDirectories: string[] = [];
const openServers: Array<{ close(): Promise<void> }> = [];

afterEach(async () => {
	for (const server of openServers.splice(0)) await server.close();
	for (const dir of tempDirectories.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function tempPaths(): DaemonPaths {
	const root = mkdtempSync(join(tmpdir(), "lsp-daemon-auth-"));
	tempDirectories.push(root);
	return daemonTestPaths(root);
}

function fallbackTempPaths(): DaemonPaths {
	const root = mkdtempSync("/tmp/omo-lsp-security-smoke-");
	tempDirectories.push(root);
	const longBase = join(root, "state", "..", "state", "x".repeat(130));
	const endpointTmp = join(root, "tmp");
	return daemonPaths(
		{ [OMO_LSP_DAEMON_DIR]: longBase },
		{ cliPath: join(root, "packaged-cli.js"), version: "test" },
		{
			platform: "linux",
			homedir: () => root,
			tmpdir: () => endpointTmp,
			getuid: () => (typeof process.getuid === "function" ? process.getuid() : undefined),
			username: () => "qa-user",
			path,
		},
	);
}

function existingContext(root: string) {
	mkdirSync(root, { recursive: true });
	const cwd = realpathSync(root);
	return {
		cwd,
		projectConfigPaths: [join(cwd, "lsp.json")],
		userConfigPath: join(cwd, "user-lsp.json"),
		installDecisionsPath: join(cwd, "install-decisions.json"),
		capabilities: { installDecisionTool: true },
	};
}

function rawRequest(paths: DaemonPaths, token: string): Promise<Record<string, unknown>> {
	return new Promise((resolve, reject) => {
		const socket = connect(paths.socket);
		const decoder = createLineDecoder((message) => resolve(message as Record<string, unknown>));
		socket.once("connect", () => {
			socket.write(
				encodeJsonLine({
					jsonrpc: "2.0",
					id: 1,
					method: "tools/call",
					params: { _omo: { protocolVersion: 1, token }, name: "status", arguments: { _context: existingContext(paths.dir) } },
				}),
			);
		});
		socket.on("data", (chunk) => decoder.push(chunk));
		socket.once("error", reject);
	});
}

describe("daemon IPC authentication and ownership", () => {
	it("given a running daemon when pinging and calling then auth is required and tokens are never forwarded", async () => {
		const paths = tempPaths();
		const server = await startDaemonServer(paths, { onIdleShutdown: () => {} });
		openServers.push(server);

		expect(await probeDaemon(paths)).toBe(true);
		const missingAuth = await rawRequest(paths, "");
		expect((missingAuth["error"] as { data?: { code?: string } }).data?.code).toBe("daemon_authentication_failed");

		const token = readFileSync(paths.auth, "utf8").trim();
		const response = await rawRequest(paths, token);
		expect(response["result"]).toBeDefined();
		expect(JSON.stringify(response)).not.toContain(token);
	});

	it("given an authenticated request with the wrong protocol when routed then it is rejected before dispatch", async () => {
		const paths = tempPaths();
		const server = await startDaemonServer(paths, { onIdleShutdown: () => {} });
		openServers.push(server);
		const token = readFileSync(paths.auth, "utf8").trim();
		const response = await new Promise<Record<string, unknown>>((resolve, reject) => {
			const socket = connect(paths.socket);
			const decoder = createLineDecoder((message) => resolve(message as Record<string, unknown>));
			socket.once("connect", () => {
				socket.write(
					encodeJsonLine({
						jsonrpc: "2.0",
						id: 9,
						method: "tools/call",
						params: { _omo: { protocolVersion: 2, token }, name: "status", arguments: {} },
					}),
				);
			});
			socket.on("data", (chunk) => decoder.push(chunk));
			socket.once("error", reject);
		});

		expect((response["error"] as { data?: { code?: string } }).data?.code).toBe("daemon_protocol_mismatch");
		expect(JSON.stringify(response)).not.toContain(token);
	});

	it("given two authenticated contexts when routed through one daemon then both existing cwd scopes are honored", async () => {
		const paths = tempPaths();
		const server = await startDaemonServer(paths, { onIdleShutdown: () => {} });
		openServers.push(server);
		const firstRoot = realpathSync(mkdtempSync(join(tmpdir(), "lsp-context-a-")));
		const secondRoot = realpathSync(mkdtempSync(join(tmpdir(), "lsp-context-b-")));
		tempDirectories.push(firstRoot, secondRoot);

		const first = await callToolViaDaemon("status", {}, { paths, ensure: async () => {}, context: existingContext(firstRoot) });
		const second = await callToolViaDaemon("status", {}, { paths, ensure: async () => {}, context: existingContext(secondRoot) });

		expect(first.content[0]?.text).toContain("Configured LSP servers");
		expect(second.content[0]?.text).toContain("Configured LSP servers");
	});

	it("given Unix state paths when daemon starts then dirs and metadata use private modes", async () => {
		if (process.platform === "win32") return;
		const paths = tempPaths();
		const server = await startDaemonServer(paths, { onIdleShutdown: () => {} });
		openServers.push(server);

		expect(statSync(paths.dir).mode & 0o777).toBe(0o700);
		expect(statSync(paths.auth).mode & 0o777).toBe(0o600);
		expect(statSync(paths.owner).mode & 0o777).toBe(0o600);
		expect(statSync(paths.endpoint).mode & 0o777).toBe(0o600);
		expect(statSync(paths.pid).mode & 0o777).toBe(0o600);
		expect(statSync(paths.socket).mode & 0o777).toBe(0o600);
	});

	it("given a pre-created hashed fallback endpoint directory symlink when daemon starts then startup fails before binding", async () => {
		if (process.platform === "win32") return;
		const paths = fallbackTempPaths();
		const endpointDir = dirname(paths.socket);
		const hostileTarget = mkdtempSync(join(tmpdir(), "lsp-daemon-hostile-target-"));
		tempDirectories.push(hostileTarget);
		mkdirSync(dirname(endpointDir), { recursive: true });
		symlinkSync(hostileTarget, endpointDir, "dir");

		await expect(startDaemonServer(paths, { onIdleShutdown: () => {} })).rejects.toMatchObject({
			code: "unsafe_private_directory",
			reason: "symlink",
		});
		expect(existsSync(paths.socket)).toBe(false);
	});

	it("given a pre-created regular file at the hashed fallback endpoint directory when daemon starts then startup fails closed", async () => {
		if (process.platform === "win32") return;
		const paths = fallbackTempPaths();
		const endpointDir = dirname(paths.socket);
		mkdirSync(dirname(endpointDir), { recursive: true });
		writeFileSync(endpointDir, "hostile-file");

		await expect(startDaemonServer(paths, { onIdleShutdown: () => {} })).rejects.toMatchObject({
			code: "unsafe_private_directory",
			reason: "not_directory",
		});
		expect(existsSync(paths.socket)).toBe(false);
	});

	it("given a pre-existing private directory owned by another uid when checking ownership then it is rejected deterministically", () => {
		if (process.platform === "win32" || typeof process.getuid !== "function") return;
		const root = mkdtempSync(join(tmpdir(), "lsp-daemon-wrong-owner-"));
		tempDirectories.push(root);
		const currentUid = process.getuid();
		const realStats = lstatSync(root);

		expect(() =>
			ensurePrivateDirectory(root, {
				currentUid: () => currentUid,
				lstat: (target) => ({
					...lstatSync(target),
					isDirectory: () => realStats.isDirectory(),
					isSymbolicLink: () => realStats.isSymbolicLink(),
					uid: currentUid + 1,
				}),
			}),
		).toThrow(expect.objectContaining({ code: "unsafe_private_directory", reason: "wrong_owner" }));
	});

	it("given a current-user hashed fallback endpoint directory with loose mode when daemon starts then it is accepted and made private", async () => {
		if (process.platform === "win32") return;
		const paths = fallbackTempPaths();
		const endpointDir = dirname(paths.socket);
		mkdirSync(endpointDir, { recursive: true, mode: 0o777 });
		chmodSync(endpointDir, 0o777);

		const server = await startDaemonServer(paths, { onIdleShutdown: () => {} });
		openServers.push(server);

		expect(lstatSync(endpointDir).isSymbolicLink()).toBe(false);
		expect(paths.socket).not.toContain("..");
		expect(statSync(endpointDir).mode & 0o777).toBe(0o700);
		expect(statSync(paths.socket).mode & 0o777).toBe(0o600);
	});

	it("given an existing authenticated owner when another candidate starts then it proves reuse and exits cleanly", async () => {
		const paths = tempPaths();
		const server = await startDaemonServer(paths, { onIdleShutdown: () => {} });
		openServers.push(server);
		const owner = readDaemonOwner(paths);

		await expect(startDaemonServer(paths, { onIdleShutdown: () => {} })).rejects.toBeInstanceOf(
			DaemonAlreadyRunningError,
		);
		expect(readDaemonOwner(paths)).toEqual(owner);
	});

	it("given live unreachable owner metadata when candidate starts then it defers without unlinking endpoint", async () => {
		const paths = tempPaths();
		mkdirSync(paths.dir, { recursive: true });
		writeFileSync(paths.auth, "x".repeat(43), { mode: 0o600 });
		writeFileSync(paths.owner, JSON.stringify({ pid: process.pid, nonce: "live", startedAt: "now", endpoint: { path: paths.socket } }), {
			mode: 0o600,
		});
		writeFileSync(paths.endpoint, paths.socket, { mode: 0o600 });

		await expect(startDaemonServer(paths, { onIdleShutdown: () => {} })).rejects.toBeInstanceOf(
			DaemonStartupDeferredError,
		);
		expect(existsSync(paths.owner)).toBe(true);
	});

	it("given a dead unchanged owner when candidate starts then it rotates auth and takes ownership", async () => {
		const paths = tempPaths();
		mkdirSync(paths.dir, { recursive: true });
		writeFileSync(paths.auth, "old-token", { mode: 0o600 });
		writeFileSync(paths.owner, JSON.stringify({ pid: 9_999_999, nonce: "dead", startedAt: "old", endpoint: { path: paths.socket } }), {
			mode: 0o600,
		});
		writeFileSync(paths.endpoint, paths.socket, { mode: 0o600 });
		const server = await startDaemonServer(paths, { onIdleShutdown: () => {} });
		openServers.push(server);

		expect(readFileSync(paths.auth, "utf8").trim()).not.toBe("old-token");
		expect(readDaemonOwner(paths)?.nonce).not.toBe("dead");
	});

	it("given a stale close from an old owner when a new owner exists then winner metadata survives", async () => {
		const paths = tempPaths();
		const first = await startDaemonServer(paths, { onIdleShutdown: () => {} });
		const oldOwner = readDaemonOwner(paths);
		await first.close();
		const second = await startDaemonServer(paths, { onIdleShutdown: () => {} });
		openServers.push(second);

		if (oldOwner) removeDaemonMetadataForOwner(paths, oldOwner);
		expect(existsSync(paths.owner)).toBe(true);
		expect(await probeDaemon(paths)).toBe(true);
	});
});
