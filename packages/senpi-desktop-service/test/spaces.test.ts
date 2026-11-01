import { afterEach, describe, expect, it } from "vitest";
import { runComputerCode } from "../src/run/runtime";
import { DesktopService } from "../src/service/service";
import { fakeEngineFactory } from "./harness";

const services: DesktopService[] = [];
afterEach(async () => {
	await Promise.all(services.splice(0).map((service) => service.close()));
});

async function open(readOnly = false) {
	const log = fakeEngineFactory({ FAKE_ENGINE_DESKTOP: "1" });
	const service = new DesktopService({ createChild: log.factory });
	services.push(service);
	await service.open({});
	const run = (code: string) =>
		runComputerCode(
			{
				code,
				timeoutMs: 5_000,
				snapshot: {
					cwd: "/work", sessionId: "spaces-test", captureMaxWidth: 3840,
					captureMaxHeight: 2400, captureMaxBytes: 5_000_000, display: "active",
					readOnly, stopHotkey: "ctrl+alt+shift+escape", allowHostRelayOnlyStop: false,
				},
			},
			{ service, executeTool: async () => undefined },
		);
	return { log, run };
}

const BRING_MAIL = `
	const mail = await desktop.window({ app: "Mail" });
	await mail.bringToCurrentSpace();
`;

describe("window bringToCurrentSpace facade", { timeout: 30_000 }, () => {
	it("sends window.bringToCurrentSpace by window id with no grant step before it", async () => {
		// Given
		const { log, run } = await open();
		// When
		await run(BRING_MAIL);
		// Then
		const moves = log.requests.filter((request) => request.method === "window.bringToCurrentSpace");
		expect(moves.map((request) => request.params)).toEqual([{ windowId: "202" }]);
		expect(log.requests.some((request) => request.method === "control.grant")).toBe(false);
	});

	it("refuses it in a read-only run before dispatch", async () => {
		// Given
		const { log, run } = await open(true);
		// When / Then
		await expect(run(BRING_MAIL)).rejects.toMatchObject({ reason: "readOnly" });
		expect(log.requests.some((request) => request.method === "window.bringToCurrentSpace")).toBe(false);
	});
});
