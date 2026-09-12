import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getLspManager } from "@oh-my-opencode/lsp-core/lsp/manager";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type DaemonServerHandle, startDaemonServer } from "../src/daemon-server.js";
import { startStatusMirror } from "../src/status-mirror.js";
import { daemonTestPaths } from "./daemon-path-fixture.js";

vi.mock("@oh-my-opencode/lsp-core/lsp/manager", () => ({
	getLspManager: vi.fn(),
	disposeDefaultLspManager: vi.fn(async () => {}),
}));

vi.mock("node:fs", async (importOriginal) => {
	const actual = await importOriginal<typeof import("node:fs")>();
	return {
		...actual,
		renameSync: vi.fn(actual.renameSync),
		writeFileSync: vi.fn(actual.writeFileSync),
	};
});

const managerMock = vi.mocked(getLspManager);
const renameMock = vi.mocked(renameSync);
const writeMock = vi.mocked(writeFileSync);
const tempDirectories: string[] = [];
const servers: DaemonServerHandle[] = [];

beforeEach(() => {
	vi.useFakeTimers();
	renameMock.mockClear();
	writeMock.mockClear();
});

afterEach(async () => {
	vi.useRealTimers();
	managerMock.mockReset();
	for (const server of servers.splice(0)) await server.close();
	for (const directory of tempDirectories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

function tempPaths() {
	const directory = mkdtempSync(join(tmpdir(), "lsp-daemon-status-mirror-"));
	tempDirectories.push(directory);
	const paths = daemonTestPaths(directory);
	mkdirSync(paths.dir, { recursive: true });
	return paths;
}

describe("startStatusMirror", () => {
	it("writes the versioned status shape with only public client fields", () => {
		const paths = tempPaths();
		const updatedAt = 1_789_226_530_000;
		vi.setSystemTime(updatedAt);
		managerMock.mockReturnValue({
			getSnapshot: () => [
				{
					serverId: "typescript",
					root: "/abs/path",
					alive: true,
					isInitializing: false,
					refCount: 1,
					command: ["tsserver"],
					pendingWaiters: 2,
					lastUsedAt: 3,
				},
			],
		} as unknown as ReturnType<typeof getLspManager>);

		const stop = startStatusMirror(paths);
		const status = JSON.parse(readFileSync(join(paths.dir, "status.json"), "utf8")) as Record<string, unknown>;

		expect(status).toEqual({
			version: 1,
			updatedAt,
			pid: process.pid,
			clients: [{ serverId: "typescript", root: "/abs/path", alive: true, isInitializing: false, refCount: 1 }],
		});
		stop();
	});

	it("writes through a temporary file before renaming to the status path", () => {
		const paths = tempPaths();
		managerMock.mockReturnValue({ getSnapshot: () => [] } as unknown as ReturnType<typeof getLspManager>);

		const stop = startStatusMirror(paths);

		expect(renameMock).toHaveBeenCalledWith(join(paths.dir, "status.json.tmp"), join(paths.dir, "status.json"));
		expect(renameMock).toHaveBeenCalledTimes(1);
		expect(writeMock).toHaveBeenCalledWith(
			join(paths.dir, "status.json.tmp"),
			expect.any(String),
			expect.objectContaining({ mode: 0o600 }),
		);
		expect(writeMock.mock.calls.every(([path]) => path !== join(paths.dir, "status.json"))).toBe(true);
		stop();
	});

	it("clears its interval and removes both status artifacts on stop", async () => {
		const paths = tempPaths();
		managerMock.mockReturnValue({ getSnapshot: () => [] } as unknown as ReturnType<typeof getLspManager>);
		const stop = startStatusMirror(paths, 100);
		writeFileSync(join(paths.dir, "status.json.tmp"), "leftover", { mode: 0o600 });

		stop();
		await vi.advanceTimersByTimeAsync(100);

		expect(existsSync(join(paths.dir, "status.json"))).toBe(false);
		expect(existsSync(join(paths.dir, "status.json.tmp"))).toBe(false);
	});

	it("logs a write error and retries on the next tick", async () => {
		const paths = tempPaths();
		managerMock.mockReturnValue({ getSnapshot: () => [] } as unknown as ReturnType<typeof getLspManager>);
		const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
		renameMock.mockImplementationOnce(() => {
			throw new Error("temporary rename failure");
		});

		const stop = startStatusMirror(paths, 100);
		expect(stderrSpy).toHaveBeenCalledWith(expect.stringContaining("temporary rename failure"));
		await vi.advanceTimersByTimeAsync(100);

		expect(existsSync(join(paths.dir, "status.json"))).toBe(true);
		stop();
		stderrSpy.mockRestore();
		renameMock.mockReset();
	});

	it("creates the mirror after daemon startup and removes it on close", async () => {
		const paths = tempPaths();
		managerMock.mockReturnValue({ getSnapshot: () => [] } as unknown as ReturnType<typeof getLspManager>);

		const server = await startDaemonServer(paths, { onIdleShutdown: () => {} });
		servers.push(server);

		expect(existsSync(join(paths.dir, "status.json"))).toBe(true);
		await server.close();

		expect(existsSync(join(paths.dir, "status.json"))).toBe(false);
		expect(existsSync(join(paths.dir, "status.json.tmp"))).toBe(false);
		servers.splice(servers.indexOf(server), 1);
	});
});
