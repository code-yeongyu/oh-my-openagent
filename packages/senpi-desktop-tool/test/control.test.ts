import type { ExecuteTool } from "@oh-my-opencode/senpi-desktop-service";
import { afterEach, describe, expect, it } from "vitest";
import { rejectionOf } from "../../senpi-desktop-service/test/harness";
import { createComputerTool, type ControlConfirmRequest } from "../src/tool";
import { closeDesktops, desktopFixture, hostContext, methodsOf } from "./fixtures";

// Every case waits on real child-process I/O; the guard only catches a hang, it never times behavior.
const HANG_GUARD = { timeout: 30_000 };

afterEach(closeDesktops);

const noTools: ExecuteTool = () => Promise.reject(new Error("no tools"));

describe("computer tool control (#9651 B5b)", HANG_GUARD, () => {
	it("grants after the injected confirm approves", async () => {
		// Given
		const { handle, log } = desktopFixture();
		const requests: ControlConfirmRequest[] = [];
		const tool = createComputerTool({
			handle,
			executeTool: noTools,
			confirmControl: (request) => {
				requests.push(request);
				return Promise.resolve(true);
			},
		});

		// When
		const result = await tool.execute(
			"call-1",
			{ action: "call", chain: [{ method: "control.acquire", args: [{ reason: "click Run" }] }] },
			undefined,
			undefined,
			hostContext(),
		);

		// Then
		expect(result.details.value).toMatchObject({ active: true });
		expect(requests.map((request) => request.reason)).toEqual(["click Run"]);
		const grant = log.requests.find((request) => request.method === "control.grant");
		expect(grant?.params).toEqual({ reason: "click Run", confirmationId: expect.any(String) });
	});

	it("a refusal stays ungranted and sends no control.grant", async () => {
		// Given
		const { handle, log } = desktopFixture();
		const tool = createComputerTool({
			handle,
			executeTool: noTools,
			confirmControl: () => Promise.resolve(false),
		});

		// When
		const result = await tool.execute(
			"call-1",
			{ action: "call", chain: [{ method: "control.acquire", args: [{ reason: "click Run" }] }] },
			undefined,
			undefined,
			hostContext(),
		);

		// Then
		expect(result.details.value).toEqual({ active: false });
		expect(methodsOf(log)).not.toContain("control.grant");
	});

	it("sends control.revoke when a computer run errors while granted", async () => {
		// Given
		const { handle, log } = desktopFixture();
		const tool = createComputerTool({ handle, executeTool: noTools, confirmControl: () => Promise.resolve(true) });

		// When
		const error = await rejectionOf(
			tool.execute(
				"call-1",
				{ action: "run", code: "await desktop.control.acquire({ reason: 'click Run' }); throw new Error('boom');" },
				undefined,
				undefined,
				hostContext(),
			),
		);

		// Then
		expect(error).toMatchObject({ message: expect.stringContaining("boom") });
		await log.nthRequest("control.revoke", 1);
	});

	it("sends control.revoke when the tool call is aborted mid-run while granted", async () => {
		// Given
		const { handle, log } = desktopFixture();
		const tool = createComputerTool({ handle, executeTool: noTools, confirmControl: () => Promise.resolve(true) });
		const controller = new AbortController();
		const promise = tool.execute(
			"call-1",
			{
				action: "run",
				code: "await desktop.control.acquire({ reason: 'click Run' }); await desktop.windows(); await wait(() => false, { timeout: 4000, interval: 50 });",
			},
			controller.signal,
			undefined,
			hostContext(),
		);
		await log.nthRequest("windows", 1);

		// When
		controller.abort();

		// Then
		const error = await rejectionOf(promise);
		expect(error).toMatchObject({ message: expect.stringContaining("aborted") });
		await log.nthRequest("control.revoke", 1);
	});

	it("maps ControlRequired to a failure that tells the model to acquire first", async () => {
		// Given
		const { handle } = desktopFixture({}, { FAKE_ENGINE_INPUT_ERROR: "ControlRequired" });
		const tool = createComputerTool({ handle, executeTool: noTools });

		// When
		const result = await tool.execute(
			"call-1",
			{ action: "call", chain: [{ method: "click", args: [1, 2, { delivery: "foreground" }] }] },
			undefined,
			undefined,
			hostContext(),
		);

		// Then
		expect(result.isError).toBe(true);
		expect(result.details.value).toMatchObject({ code: "COMPUTER_CONTROL_REQUIRED" });
	});

	it("maps InputBusy to a retry-later failure", async () => {
		// Given
		const { handle } = desktopFixture({}, { FAKE_ENGINE_CONTROL_BUSY: "1" });
		const tool = createComputerTool({
			handle,
			executeTool: noTools,
			confirmControl: () => Promise.resolve(true),
		});

		// When
		const result = await tool.execute(
			"call-1",
			{ action: "call", chain: [{ method: "control.acquire", args: [{ reason: "click Run" }] }] },
			undefined,
			undefined,
			hostContext(),
		);

		// Then
		expect(result.isError).toBe(true);
		expect(result.details.value).toMatchObject({ code: "COMPUTER_INPUT_BUSY" });
	});

	it("reports a latched stop as the stop failure, never as a grant", async () => {
		// Given: the engine refuses control.grant Suspended while the user's stop is latched (6f20a8e01)
		const { handle, log } = desktopFixture({}, { FAKE_ENGINE_GRANT_ERROR: "Suspended" });
		const tool = createComputerTool({
			handle,
			executeTool: noTools,
			confirmControl: () => Promise.resolve(true),
		});

		// When
		const result = await tool.execute(
			"call-1",
			{ action: "call", chain: [{ method: "control.acquire", args: [{ reason: "click Run" }] }] },
			undefined,
			undefined,
			hostContext(),
		);

		// Then
		expect(result.isError).toBe(true);
		expect(result.details.value).toMatchObject({ code: "COMPUTER_SUSPENDED" });
		expect(methodsOf(log).filter((method) => method === "control.grant")).toHaveLength(1);
	});
});
