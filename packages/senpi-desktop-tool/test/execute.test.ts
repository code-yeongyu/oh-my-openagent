import { join } from "node:path";
import { ComputerCallError } from "@oh-my-opencode/senpi-desktop-protocol";
import type { ExecuteTool } from "@oh-my-opencode/senpi-desktop-service";
import { afterEach, describe, expect, it } from "vitest";
import { rejectionOf } from "../../senpi-desktop-service/test/harness";
import type { ComputerHandle } from "../src/activation";
import { AUDIT_FILE_NAME, type ComputerModel } from "../src/session";
import { createComputerTool } from "../src/tool";
import { closeDesktops, desktopFixture, hostContext, methodsOf } from "./fixtures";

// Every case waits on real child-process I/O; the guard only catches a hang, it never times behavior.
const HANG_GUARD = { timeout: 30_000 };

const claude: ComputerModel = { id: "claude-sonnet-4-6", provider: "anthropic", api: "anthropic-messages" };
const detailedModel: ComputerModel = { id: "gpt-5.6", provider: "openai", api: "openai-responses", compat: {} };

afterEach(closeDesktops);

const noTools: ExecuteTool = () => Promise.reject(new Error("no tools"));

function toolFor(handle: ComputerHandle, executeTool: ExecuteTool = noTools) {
	return createComputerTool({ handle, executeTool });
}

describe("computer tool execute", HANG_GUARD, () => {
	it("runs a window->screenshot chain through the facade and returns the inline image", async () => {
		// Given
		const { handle } = desktopFixture();
		const params = {
			action: "call" as const,
			chain: [{ method: "window", args: ["101"] }, { method: "screenshot" }],
		};

		// When
		const result = await toolFor(handle).execute("call-1", params, undefined, undefined, hostContext());

		// Then
		expect({
			images: result.content.filter((part) => part.type === "image").length,
			value: result.details.value,
		}).toMatchInlineSnapshot(`
			{
			  "images": 1,
			  "value": {
			    "frameId": "101-1",
			    "height": 800,
			    "scale": 1,
			    "sourceHeight": 800,
			    "sourceWidth": 1200,
			    "target": "101",
			    "width": 1200,
			  },
			}
		`);
	});

	it("rejects a userReset chain as an unknown method before any engine is started", async () => {
		// Given
		const { handle, log } = desktopFixture();
		const params = { action: "call" as const, chain: [{ method: "userReset" }] };

		// When
		const error = await rejectionOf(toolFor(handle).execute("call-1", params, undefined, undefined, hostContext()));

		// Then
		expect({
			reason: error instanceof ComputerCallError ? error.reason : error,
			spawned: log.children.length,
		}).toEqual({ reason: "unknownMethod", spawned: 0 });
	});

	it("refuses input inside a read_only run before it reaches the engine", async () => {
		// Given: a read_only run whose code clicks.
		const { handle, log } = desktopFixture();
		const params = { action: "run" as const, code: "await desktop.click(1, 1);", read_only: true };

		// When
		const error = await rejectionOf(toolFor(handle).execute("call-1", params, undefined, undefined, hostContext()));

		// Then
		expect({
			message: error instanceof Error ? error.message : error,
			clicks: methodsOf(log).filter((m) => m === "click"),
		}).toEqual({ message: "read-only run: 'click' requires read_only: false", clicks: [] });
	});

	it("reaches host tools from run code through the injected executeTool", async () => {
		// Given
		const { handle } = desktopFixture();
		const executeTool = (name: string, params: unknown) => Promise.resolve({ name, params });
		const params = { action: "run" as const, code: 'return await tool.read({ path: "a.txt" });' };

		// When
		const result = await toolFor(handle, executeTool).execute("call-1", params, undefined, undefined, hostContext());

		// Then
		expect(result.details.value).toEqual({ name: "read", params: { path: "a.txt" } });
	});

	it("returns live capabilities as the facade value", async () => {
		// Given
		const { handle } = desktopFixture();

		// When
		const result = await toolFor(handle).execute(
			"call-1",
			{ action: "capabilities" },
			undefined,
			undefined,
			hostContext(),
		);

		// Then
		expect(result.details.value).toMatchObject({ backend: "fake", stopPath: "global", focusGuard: true });
	});

	it("opens the session with the audit path, tmp artifacts, and coordinate-safe caps for a Claude model", async () => {
		// Given
		const { handle, log } = desktopFixture({ maxWidth: 2000, screenshotMaxBytes: 1_000_000 });

		// When
		await toolFor(handle).execute("call-1", { action: "capabilities" }, undefined, undefined, hostContext(claude));

		// Then
		const open = log.requests.find((request) => request.method === "session.open");
		expect(open?.params).toMatchObject({
			auditPath: join("/sessions/project", AUDIT_FILE_NAME),
			captureCaps: { maxWidth: 2000, maxHeight: 2400, coordinateSafe: true, maxBytes: 1_000_000 },
			screenshotGc: { staleMs: 43_200_000, scanIntervalMs: 1_800_000 },
		});
	});

	it("turns auditing off and keeps native caps when settings and model ask for it", async () => {
		// Given
		const { handle, log } = desktopFixture({ auditLog: { enabled: false } });

		// When
		await toolFor(handle).execute(
			"call-1",
			{ action: "capabilities" },
			undefined,
			undefined,
			hostContext(detailedModel),
		);

		// Then
		const open = log.requests.find((request) => request.method === "session.open");
		expect(open?.params).toMatchObject({ auditPath: null, captureCaps: { coordinateSafe: false } });
	});

	it("arms the configured stop chord once across repeated calls", async () => {
		// Given
		const { handle, log } = desktopFixture({ stopHotkey: "ctrl+alt+shift+f12" });
		const tool = toolFor(handle);

		// When
		await tool.execute("call-1", { action: "capabilities" }, undefined, undefined, hostContext());
		await tool.execute("call-2", { action: "capabilities" }, undefined, undefined, hostContext());

		// Then
		const starts = log.requests.filter((request) => request.method === "stopPath.start");
		expect({
			starts: starts.map((request) => request.params),
			opens: methodsOf(log).filter((m) => m === "session.open").length,
		}).toEqual({ starts: [{ chord: "ctrl+alt+shift+f12" }], opens: 1 });
	});
});
