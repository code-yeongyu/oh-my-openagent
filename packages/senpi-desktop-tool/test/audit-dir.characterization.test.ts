// X17 characterization (plan row P0-06h): pins today's computer-use audit and capture path.
// The engine writes the audit file itself; the host decides where (session.open `auditPath`), where capture
// artifacts go (`artifactDir`), the capture caps and screenshot GC, and returns each run's audit records and
// artifact screenshots in the tool result. Every case drives the real `computer` tool over a real
// `DesktopService` whose engine child is the scripted fake desktop, and reads the wire requests it logged.
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExecuteTool } from "@oh-my-opencode/senpi-desktop-service";
import { afterEach, describe, expect, it } from "vitest";
import type { ComputerHandle } from "../src/activation";
import {
	AUDIT_FILE_NAME,
	type ComputerHostContext,
	type ComputerModel,
	runSnapshot,
	usesCoordinateSafeImageSizing,
} from "../src/session";
import { resolveComputerSettings } from "../src/settings";
import { createComputerTool } from "../src/tool";
import { closeDesktops, desktopFixture, hostContext, methodsOf } from "./fixtures";

// Every case waits on real child-process I/O; the guard only catches a hang, it never times behavior.
const HANG_GUARD = { timeout: 30_000 };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

afterEach(closeDesktops);

const noTools: ExecuteTool = () => Promise.reject(new Error("no tools"));

function toolFor(handle: ComputerHandle) {
	return createComputerTool({ handle, executeTool: noTools });
}

function contextIn(sessionDir: string, cwd = "/work"): ComputerHostContext {
	return {
		cwd,
		model: undefined,
		sessionManager: { getSessionId: () => "session-1", getSessionDir: () => sessionDir },
	};
}

function openRequests(log: ReturnType<typeof desktopFixture>["log"]) {
	return log.requests.filter((request) => request.method === "session.open");
}

function auditAndCapture(params: unknown) {
	const { auditPath, artifactDir, screenshotGc, captureCaps } = params as Record<string, unknown>;
	return { auditPath, artifactDir, screenshotGc, captureCaps };
}

describe("X17: computer-use audit and capture path (today)", HANG_GUARD, () => {
	it("#given default settings #when the tool first activates #then session.open puts the audit file in the session directory and artifacts in the OS tmpdir", async () => {
		// Given
		const { handle, log } = desktopFixture();

		// When
		await toolFor(handle).execute("call-1", { action: "capabilities" }, undefined, undefined, hostContext());

		// Then
		const opens = openRequests(log);
		expect(opens).toHaveLength(1);
		expect(AUDIT_FILE_NAME).toBe(".computer-audit.jsonl");
		expect(auditAndCapture(opens[0]?.params)).toEqual({
			auditPath: join("/sessions/project", ".computer-audit.jsonl"),
			artifactDir: tmpdir(),
			screenshotGc: { staleMs: 43_200_000, scanIntervalMs: 1_800_000 },
			captureCaps: { maxWidth: 3840, maxHeight: 2400, coordinateSafe: false, maxBytes: 5_000_000 },
		});
	});

	it("#given the session directory differs from cwd #when the tool activates #then the audit file follows the session directory, not cwd", async () => {
		// Given
		const { handle, log } = desktopFixture();
		const context = contextIn("/sessions/elsewhere", "/work/repo");

		// When
		await toolFor(handle).execute("call-1", { action: "capabilities" }, undefined, undefined, context);

		// Then
		expect(openRequests(log).map((request) => auditAndCapture(request.params).auditPath)).toEqual([
			join("/sessions/elsewhere", AUDIT_FILE_NAME),
		]);
	});

	it("#given auditing and screenshot GC are off #when the tool activates #then auditPath is null and nothing is ever stale", async () => {
		// Given
		const { handle, log } = desktopFixture({
			auditLog: { enabled: false },
			screenshotGc: { enabled: false, staleMs: 60_000, scanIntervalMs: 5_000 },
			maxWidth: 1600,
			maxHeight: 1000,
			screenshotMaxBytes: 250_000,
		});

		// When
		await toolFor(handle).execute("call-1", { action: "capabilities" }, undefined, undefined, hostContext());

		// Then
		expect(auditAndCapture(openRequests(log)[0]?.params)).toEqual({
			auditPath: null,
			artifactDir: tmpdir(),
			screenshotGc: { staleMs: Number.MAX_SAFE_INTEGER, scanIntervalMs: 5_000 },
			captureCaps: { maxWidth: 1600, maxHeight: 1000, coordinateSafe: false, maxBytes: 250_000 },
		});
	});

	it("#given GC on with custom knobs #when the tool activates #then both GC knobs pass through unchanged", async () => {
		// Given
		const { handle, log } = desktopFixture({ screenshotGc: { staleMs: 60_000, scanIntervalMs: 5_000 } });

		// When
		await toolFor(handle).execute("call-1", { action: "capabilities" }, undefined, undefined, hostContext());

		// Then
		expect(auditAndCapture(openRequests(log)[0]?.params).screenshotGc).toEqual({ staleMs: 60_000, scanIntervalMs: 5_000 });
	});

	it("#given an open session #when a later call comes from another session directory #then session.open is re-sent once with the new audit path", async () => {
		// Given
		const { handle, log } = desktopFixture();
		const tool = toolFor(handle);
		await tool.execute("call-1", { action: "capabilities" }, undefined, undefined, contextIn("/sessions/a"));
		await tool.execute("call-2", { action: "capabilities" }, undefined, undefined, contextIn("/sessions/a"));

		// When
		await tool.execute("call-3", { action: "capabilities" }, undefined, undefined, contextIn("/sessions/b"));

		// Then
		expect(openRequests(log).map((request) => auditAndCapture(request.params).auditPath)).toEqual([
			join("/sessions/a", AUDIT_FILE_NAME),
			join("/sessions/b", AUDIT_FILE_NAME),
		]);
	});

	it("#given a run that captures a window and clicks it #when it finishes #then details.audit holds one host record per engine audit, stamped with the session and a run id", async () => {
		// Given
		const { handle } = desktopFixture();
		const code = `
			const editor = await desktop.window({ app: "Code" });
			await editor.screenshot({ silent: true });
			await editor.click(3, 4);
		`;

		// When
		const result = await toolFor(handle).execute("call-run", { action: "run", code }, undefined, undefined, hostContext());

		// Then
		const audit = result.details.audit ?? [];
		expect(audit).toHaveLength(1);
		const [record] = audit;
		expect(record?.runId).toMatch(UUID);
		expect(Number.isNaN(Date.parse(record?.timestamp ?? ""))).toBe(false);
		expect({ ...record, runId: "<run>", timestamp: "<time>" }).toEqual({
			timestamp: "<time>",
			sessionId: "session-1",
			runId: "<run>",
			action: "click",
			target: "101",
			delivery: "background",
			frameId: "101-1",
			code: null,
			status: "success",
			durationMs: 4,
		});
	});

	it("#given two runs #when each clicks once #then each run gets its own run id and only its own audit records", async () => {
		// Given
		const { handle } = desktopFixture();
		const tool = toolFor(handle);
		const code = `const w = await desktop.window({ app: "Code" }); await w.screenshot({ silent: true }); await w.click(1, 1);`;

		// When
		const first = await tool.execute("run-1", { action: "run", code }, undefined, undefined, hostContext());
		const second = await tool.execute("run-2", { action: "run", code }, undefined, undefined, hostContext());

		// Then
		const firstAudit = first.details.audit ?? [];
		const secondAudit = second.details.audit ?? [];
		expect([firstAudit.length, secondAudit.length]).toEqual([1, 1]);
		expect(firstAudit[0]?.runId).not.toBe(secondAudit[0]?.runId);
	});

	it("#given an inline capture and an artifact-only capture #when the run finishes #then details.screenshots lists only the artifact capture, and captures add no audit record", async () => {
		// Given
		const { handle, log } = desktopFixture();
		const code = `
			await (await desktop.window({ app: "Code" })).screenshot({ silent: true });
			await (await desktop.window({ app: "Mail" })).screenshot({ silent: true });
		`;

		// When
		const result = await toolFor(handle).execute("call-cap", { action: "run", code }, undefined, undefined, hostContext());

		// Then
		expect(methodsOf(log).filter((method) => method === "capture")).toHaveLength(2);
		expect(result.details.screenshots).toEqual([
			{ path: "/tmp/fake-captures/202-2.png", width: 900, height: 700, sourceWidth: 900, sourceHeight: 700, target: "202" },
		]);
		expect(result.details.audit).toEqual([]);
	});

	it("#given settings and a host context #when a run snapshot is taken #then the capture caps and session id come from them", () => {
		// Given
		const settings = resolveComputerSettings({ maxWidth: 1024, maxHeight: 768, screenshotMaxBytes: 99 }, "linux");

		// When
		const snapshot = runSnapshot(settings, contextIn("/sessions/x", "/work/y"), true);

		// Then
		expect(snapshot).toEqual({
			cwd: "/work/y",
			sessionId: "session-1",
			captureMaxWidth: 1024,
			captureMaxHeight: 768,
			captureMaxBytes: 99,
			display: "active",
			readOnly: true,
			stopHotkey: settings.stopHotkey,
			allowHostRelayOnlyStop: false,
		});
	});

	it.each([
		["no model", undefined, false],
		["anthropic-messages api", { id: "m", provider: "p", api: "anthropic-messages" }, true],
		["anthropic provider", { id: "m", provider: "anthropic", api: "x" }, true],
		["claude in the id, any case", { id: "My-CLAUDE-x", provider: "p", api: "x" }, true],
		["compat says no original detail", { id: "m", provider: "p", api: "x", compat: { supportsImageDetailOriginal: false } }, true],
		["compat allows original detail", { id: "m", provider: "p", api: "x", compat: { supportsImageDetailOriginal: true } }, false],
		["a non-Claude model", { id: "gpt-5.6", provider: "openai", api: "openai-responses", compat: {} }, false],
	] as const)("#given %s #then coordinateSafe capture sizing is %s", (_label, model, expected) => {
		const input: ComputerModel | undefined = model;
		expect(usesCoordinateSafeImageSizing(input)).toBe(expected);
	});
});
