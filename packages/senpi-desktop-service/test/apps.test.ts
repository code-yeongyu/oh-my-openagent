import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { sessionPath } from "../src/run/apps";
import { runComputerCode } from "../src/run/runtime";
import { describeWindowMiss } from "../src/run/window-miss";
import { DesktopService } from "../src/service/service";
import { fakeEngineFactory } from "./harness";

const services: DesktopService[] = [];
afterEach(async () => {
	await Promise.all(services.splice(0).map((service) => service.close()));
});

async function open(options: { readOnly?: boolean; env?: Record<string, string>; cwd?: string } = {}) {
	const log = fakeEngineFactory({ FAKE_ENGINE_DESKTOP: "1", ...options.env });
	const service = new DesktopService({ createChild: log.factory });
	services.push(service);
	await service.open({});
	const run = (code: string) =>
		runComputerCode(
			{
				code,
				timeoutMs: 5_000,
				snapshot: {
					cwd: options.cwd ?? "/work", sessionId: "apps-test", captureMaxWidth: 3840,
					captureMaxHeight: 2400, captureMaxBytes: 5_000_000, display: "active",
					readOnly: options.readOnly ?? false, stopHotkey: "ctrl+alt+shift+escape", allowHostRelayOnlyStop: false,
				},
			},
			{ service, executeTool: async () => undefined },
		);
	return { log, run };
}

describe("desktop.apps facade", { timeout: 30_000 }, () => {
	it("lists applications through apps.list with its options and never a grant", async () => {
		// Given
		const { log, run } = await open();
		// When
		const result = await run(`return await desktop.apps.list({ query: "notes", runningOnly: false });`);
		// Then
		expect(result.returnValue).toEqual([{ id: "com.apple.Notes", name: "Notes", path: "/Applications/Notes.app", running: false }]);
		const lists = log.requests.filter((request) => request.method === "apps.list");
		expect(lists.map((request) => request.params)).toEqual([{ query: "notes", runningOnly: false }]);
		expect(log.requests.some((request) => request.method === "control.grant")).toBe(false);
	});

	it("opens an application in the background and returns its window as a live handle", async () => {
		// Given
		const { log, run } = await open();
		// When
		const result = await run(`
			const app = await desktop.apps.open("Notes");
			const shot = await app.window.screenshot({ silent: true });
			return [app.id, app.running, app.window.id, app.window.app, shot.target];
		`);
		// Then: no activate on the wire, the handle drives the engine by window id, no grant step
		expect(result.returnValue).toEqual(["com.apple.Notes", true, "202", "Mail", "202"]);
		const opens = log.requests.filter((request) => request.method === "apps.open");
		expect(opens.map((request) => request.params)).toEqual([{ id: "Notes" }]);
		expect(log.requests.some((request) => request.method === "control.grant")).toBe(false);
	});

	it("resolves a relative document path against the session cwd and keeps an exact app id", async () => {
		// Given: a file in the session folder, and an id the inventory knows
		const cwd = mkdtempSync(path.join(tmpdir(), "senpi-desktop-apps-"));
		writeFileSync(path.join(cwd, "notes.txt"), "x");
		try {
			const { log, run } = await open({ cwd });
			// When
			const tolerant = (code: string) => run(code).catch(() => undefined);
			await tolerant(`await desktop.apps.open("notes.txt");`);
			await tolerant(`await desktop.apps.open("./draft.md", { app: "Code" });`);
			await run(`await desktop.apps.open("Code");`);
			// Then
			const opens = log.requests.filter((request) => request.method === "apps.open").map((request) => request.params);
			expect(opens).toEqual([
				{ id: path.join(cwd, "notes.txt") },
				{ id: path.join(cwd, "draft.md"), app: "Code" },
				{ id: "Code" },
			]);
		} finally {
			rmSync(cwd, { recursive: true, force: true });
		}
	});

	it("passes activate to the engine, which refuses it ControlRequired without the grant", async () => {
		// Given: the fake engine enforces the grant rule
		const { log, run } = await open({ env: { FAKE_ENGINE_GLOBAL_INPUT_GATE: "1" } });
		// When / Then
		await expect(run(`await desktop.apps.open("Notes", { activate: true });`)).rejects.toMatchObject({ data: { code: "ControlRequired" } });
		const opens = log.requests.filter((request) => request.method === "apps.open");
		expect(opens.map((request) => request.params)).toEqual([{ id: "Notes", activate: true }]);
	});

	it("refuses apps.open in a read-only run before dispatch and still allows apps.list", async () => {
		// Given
		const { log, run } = await open({ readOnly: true });
		// When / Then
		await expect(run(`await desktop.apps.open("Notes");`)).rejects.toMatchObject({ reason: "readOnly" });
		expect(log.requests.some((request) => request.method === "apps.open")).toBe(false);
		const listed = await run(`return (await desktop.apps.list()).length;`);
		expect(listed.returnValue).toBe(3);
	});

	it("names apps.open in the window-miss error and lists the open windows by app", async () => {
		// Given
		const { run } = await open();
		// When
		const error = await run(`await desktop.window({ app: "Notes" });`).catch((caught: unknown) => caught);
		// Then
		expect(error).toMatchObject({ reason: "window" });
		const message = (error as Error).message;
		expect(message).toContain('no window matches {"app":"Notes"}');
		expect(message).toContain('computer.apps.open("Notes")');
		expect(message).toContain('- Code: 101 "main.ts"');
		expect(message).toContain('- Mail: 202 "Inbox"');
	});
});

describe("sessionPath", () => {
	const listed = async (value: string) => value === "com.example.Editor" || value === "/Applications/Editor.app";

	it("keeps absolute paths, URLs, bare names of nothing, and listed identities; resolves written relative paths", async () => {
		const cwd = mkdtempSync(path.join(tmpdir(), "senpi-desktop-session-path-"));
		writeFileSync(path.join(cwd, "com.example.Editor"), "x");
		writeFileSync(path.join(cwd, "readme.md"), "x");
		try {
			expect(await sessionPath("/Applications/Editor.app", cwd, listed)).toBe("/Applications/Editor.app");
			expect(await sessionPath("https://example.com", cwd, listed)).toBe("https://example.com");
			expect(await sessionPath("Notes", cwd, listed)).toBe("Notes");
			expect(await sessionPath("./missing.txt", cwd, listed)).toBe(path.join(cwd, "missing.txt"));
			expect(await sessionPath("sub/file.txt", cwd, listed)).toBe(path.join(cwd, "sub/file.txt"));
			expect(await sessionPath("readme.md", cwd, listed)).toBe(path.join(cwd, "readme.md"));
			// An exact application id wins over a same-named entry in the session folder.
			expect(await sessionPath("com.example.Editor", cwd, listed)).toBe("com.example.Editor");
		} finally {
			rmSync(cwd, { recursive: true, force: true });
		}
	});
});

describe("describeWindowMiss", () => {
	const window = (id: string, app: string, title: string, focused = false) => ({
		id, app, title, pid: 1, x: 0, y: 0, width: 10, height: 10, focused,
	});

	it("ranks the matching app first, then the focused one, and hints apps.open once", () => {
		const windows = [window("1", "Mail", "Inbox", true), window("2", "Code", "a.ts"), window("3", "Code", "")];
		const text = describeWindowMiss(windows, "Notes", "shows-window");
		expect(text.split("\n")).toEqual([
			'No open window belongs to an app matching "Notes".',
			'computer.apps.open("Notes") opens it by that exact name or id, or shows a window of it if it runs without one, and returns it with that window (window: null if none appears within 3 s).',
			'Open windows by app (id "title"):',
			'- Mail: 1 "Inbox"',
			'- Code: 2 "a.ts", 3 ""',
		]);
	});

	it("says launches off macOS, omits the hint when a matching app has windows, and reports an empty desktop", () => {
		expect(describeWindowMiss([], "Notes", "launches")).toBe(
			'No open window belongs to an app matching "Notes".\ncomputer.apps.open("Notes") launches it by that exact name or id.\nNo windows are open.',
		);
		const text = describeWindowMiss([window("1", "Notes", "x")], "notes", "shows-window");
		expect(text).toBe('Open windows by app (id "title"):\n- Notes: 1 "x"');
		expect(describeWindowMiss([window("1", "Notes", "x")], undefined, "shows-window")).not.toContain("apps.open");
	});
});
