import { expect, it } from "vitest";
import { DesktopService, runComputerCode } from "@oh-my-opencode/senpi-desktop-service";
import { refusalChild } from "../../senpi-desktop-engine/test/refusal-child";
import { ComputerHandle } from "../src/activation";
import { runComputerCommand } from "../src/command";
import { createComputerActionsTool } from "../src/cua-adapter";
import { createComputerTool } from "../src/tool";
import { resolveComputerSettings } from "../src/settings";
import { runSnapshot } from "../src/session";
import { hostContext } from "./fixtures";

function fixture() {
	let launches = 0;
	let hostTools = 0;
	const service = new DesktopService({ createChild: () => { launches += 1; return refusalChild(); } });
	const settings = resolveComputerSettings({ auditLog: { enabled: false } }, "darwin");
	const handle = new ComputerHandle({ service, settings: () => settings });
	const deps = { handle, executeTool: async () => { hostTools += 1; return undefined; } };
	return { service, settings, handle, deps, launches: () => launches, hostTools: () => hostTools };
}

for (const input of [
	{ action: "call", chain: [{ method: "windows" }] },
	{ action: "run", code: "return await desktop.windows();", read_only: true },
	{ action: "capabilities" },
]) {
	it(`maps actual startup refusal for computer ${input.action} without permission metadata`, async () => {
		const f = fixture();
		try {
			const result = await createComputerTool(f.deps).execute("launch", input, undefined, undefined, hostContext());
			expect(result).toMatchObject({ isError: true, details: { isError: true, value: {
				code: "COMPUTER_LAUNCH_CONTEXT_REQUIRED", reason: "self-responsible",
			} } });
			expect(result.details.value).not.toHaveProperty("permission");
			expect(result.details.value).not.toHaveProperty("settingsUrl");
			expect(f.launches()).toBe(1);
			expect(f.hostTools()).toBe(0);
		} finally { await f.service.close(); }
	}, 10_000);
}

it("maps actual startup refusal for computer_actions", async () => {
	const f = fixture();
	try {
		const result = await createComputerActionsTool(f.deps).execute("launch", {
			action: "screenshot",
		}, undefined, undefined, hostContext());
		expect(result).toMatchObject({ isError: true, details: { isError: true, value: {
			code: "COMPUTER_LAUNCH_CONTEXT_REQUIRED", reason: "self-responsible",
		} } });
		expect(f.launches()).toBe(1);
		expect(f.hostTools()).toBe(0);
	} finally { await f.service.close(); }
}, 10_000);

it("keeps the typed reason and machine code for /computer on", async () => {
	const f = fixture();
	try {
		await expect(runComputerCommand("on", f.handle, hostContext())).rejects.toMatchObject({
			code: "launch-context-unavailable", reason: "self-responsible",
		});
		expect(f.handle.active).toBe(false);
		expect(f.launches()).toBe(1);
	} finally { await f.service.close(); }
}, 10_000);

it("propagates a restart refusal through the eval-facing real service facade", async () => {
	const f = fixture();
	try {
		// An explicit activation stores the desired session; a later facade call tries a new child.
		await f.service.open({}).catch((error: unknown) => {
			if (!(error instanceof Error)) throw error;
		});
		await expect(runComputerCode({
			code: "return await desktop.windows();",
			snapshot: runSnapshot(f.settings, hostContext(), true),
			timeoutMs: 5_000,
		}, { service: f.service, executeTool: f.deps.executeTool })).rejects.toMatchObject({
			code: "launch-context-unavailable", reason: "self-responsible",
		});
		expect(f.launches()).toBe(2);
	} finally { await f.service.close(); }
}, 10_000);

it("preserves a handover failure without manufacturing a child refusal", async () => {
	const original = Object.assign(new Error("handover failed; Settings > Restart engine"), { code: "handoff_failed" });
	const service = new DesktopService({ createChild: () => { throw original; } });
	await expect(service.open({})).rejects.toBe(original);
	await service.close();
});
