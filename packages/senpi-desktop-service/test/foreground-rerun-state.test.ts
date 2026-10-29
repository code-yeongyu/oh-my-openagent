import type { EngineMethod } from "@oh-my-opencode/senpi-desktop-protocol";
import { expect, test } from "vitest";
import { RunOutput } from "../src/run/context";
import { planRerun, withForegroundRerun } from "../src/run/foreground-rerun";
import { DesktopEngineRpcError } from "../src/service/rpc-client";

function refused(code: string) {
	return new DesktopEngineRpcError("typeText", { code: -32000, message: code, data: { code, hint: null } });
}

test("apps.open is rerun only for an explicit activation or reveal request", () => {
	const state = { foregroundAllowed: true, possiblyLive: false, cancelled: false };
	const method = "apps.open" as EngineMethod;
	for (const params of [{}, { activate: false }, { reveal: false }]) {
		expect(planRerun(method, params, refused("ControlRequired"), state)).toBeUndefined();
	}
	for (const params of [{ activate: true }, { reveal: true }]) {
		expect(planRerun(method, params, refused("ControlRequired"), state)?.params).toBe(params);
	}
});

test("permission loss while the automatic grant is pending prevents the rerun", async () => {
	const entered = Promise.withResolvers<void>();
	const release = Promise.withResolvers<void>();
	let allowed = true;
	let calls = 0;
	const error = refused("BackgroundUnavailable");
	const call = withForegroundRerun(
		async () => { calls += 1; throw error; },
		{
			foregroundAllowed: () => allowed,
			possiblyLive: () => false,
			grantForFullAccess: async () => { entered.resolve(); await release.promise; return true; },
		},
		new RunOutput(),
		new AbortController().signal,
	);
	const result = call("typeText", {}).catch((failure: unknown) => failure);
	await entered.promise;
	allowed = false;
	release.resolve();
	expect(await result).toBe(error);
	expect(calls).toBe(1);
});

test("seeded rerun model bounds calls and grants through state changes", async () => {
	let seed = 0x574833;
	const next = () => {
		seed ^= seed << 13;
		seed ^= seed >>> 17;
		seed ^= seed << 5;
		return seed >>> 0;
	};
	const codes = ["BackgroundUnavailable", "ControlRequired", "InputFailed", "AxUnconfirmed", "UserIntervened", "Cancelled", "Suspended"];
	for (let run = 0; run < 64; run += 1) {
		for (let step = 0; step < 40; step += 1) {
			const bits = next();
			let allowed = (bits & 1) !== 0;
			const live = (bits & 2) !== 0;
			const explicit = (bits & 4) !== 0;
			const loseDuringGrant = (bits & 8) !== 0;
			const cancelDuringGrant = (bits & 16) !== 0;
			const cancelledBefore = (bits & 32) !== 0;
			const method = (bits & 64) !== 0 ? "raiseWindow" : "typeText";
			const code = codes[next() % codes.length] ?? "Suspended";
			const eligible = method === "raiseWindow" ? code === "ControlRequired" : !explicit && code === "BackgroundUnavailable";
			const expectedRetry = allowed && !cancelledBefore && eligible;
			const expectedGrant = expectedRetry && !live;
			const controller = new AbortController();
			if (cancelledBefore) controller.abort();
			let calls = 0;
			let grants = 0;
			const output = new RunOutput();
			const call = withForegroundRerun(
				async () => {
					calls += 1;
					if (calls === 1) throw refused(code);
					return "delivered";
				},
				{
					foregroundAllowed: () => allowed,
					possiblyLive: () => live,
					grantForFullAccess: async () => {
						grants += 1;
						if (loseDuringGrant) allowed = false;
						if (cancelDuringGrant) controller.abort();
						return true;
					},
				},
				output,
				controller.signal,
			);
			await call(method, explicit ? { opts: { deliveryMode: "background" } } : {}).catch(() => undefined);
			const sentAgain = expectedRetry && !(expectedGrant && (loseDuringGrant || cancelDuringGrant));
			expect(calls, `run=${run} step=${step}`).toBe(sentAgain ? 2 : 1);
			expect(grants).toBe(expectedGrant ? 1 : 0);
			expect(output.finish().length).toBe(sentAgain ? 1 : 0);
		}
	}
});
