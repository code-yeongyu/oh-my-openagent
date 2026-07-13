import { describe, expect, test } from "bun:test";

import { resolveManagedAgentReasoning } from "./managed-agent-reasoning-defaults";

describe("resolveManagedAgentReasoning", () => {
	// given the explorer bundled defaults moved terra/medium -> luna/low -> terra/medium
	const bundled = { bundledModel: "gpt-5.6-terra", bundledEffort: "medium" };

	test("#given a preserved luna/low default #when resolving #then the new bundled effort wins", () => {
		// when
		const reasoning = resolveManagedAgentReasoning({
			agentName: "explorer",
			...bundled,
			preserved: { model: "gpt-5.6-luna", effort: "low" },
		});
		// then
		expect(reasoning).toEqual({ model: "gpt-5.6-terra", effort: "medium" });
	});

	test("#given a preserved gpt-5.4-mini/low default #when resolving #then the chained upgrade still lands on the new effort", () => {
		// when
		const reasoning = resolveManagedAgentReasoning({
			agentName: "librarian",
			...bundled,
			preserved: { model: "gpt-5.4-mini", effort: "low" },
		});
		// then
		expect(reasoning).toEqual({ model: "gpt-5.6-terra", effort: "medium" });
	});

	test("#given a user-customized effort #when resolving #then the customization is preserved", () => {
		// when
		const reasoning = resolveManagedAgentReasoning({
			agentName: "explorer",
			...bundled,
			preserved: { model: "gpt-5.6-terra", effort: "xhigh" },
		});
		// then
		expect(reasoning).toEqual({ model: "gpt-5.6-terra", effort: "xhigh" });
	});

	test("#given a custom model and effort pair #when resolving a managed role #then the pair is preserved", () => {
		// when
		const reasoning = resolveManagedAgentReasoning({
			agentName: "explorer",
			...bundled,
			preserved: { model: "custom-model", effort: "low" },
		});
		// then
		expect(reasoning).toEqual({ model: "custom-model", effort: "low" });
	});

	test("#given an unlisted bundled role with a custom tuple #when resolving #then the tuple is preserved", () => {
		// when
		const reasoning = resolveManagedAgentReasoning({
			agentName: "metis",
			bundledModel: "gpt-5.6-sol",
			bundledEffort: "high",
			preserved: { model: "custom-model", effort: "medium" },
		});
		// then
		expect(reasoning).toEqual({ model: "custom-model", effort: "medium" });
	});

	test("#given a preserved plan sol/xhigh default #when resolving against sol/max #then the new bundled effort wins", () => {
		// when
		const reasoning = resolveManagedAgentReasoning({
			agentName: "plan",
			bundledModel: "gpt-5.6-sol",
			bundledEffort: "max",
			preserved: { model: "gpt-5.6-sol", effort: "xhigh" },
		});
		// then
		expect(reasoning).toEqual({ model: "gpt-5.6-sol", effort: "max" });
	});

	test("#given a preserved worker-low luna/high default #when resolving against terra/high #then the new bundled effort wins", () => {
		// when
		const reasoning = resolveManagedAgentReasoning({
			agentName: "lazycodex-worker-low",
			bundledModel: "gpt-5.6-terra",
			bundledEffort: "high",
			preserved: { model: "gpt-5.6-luna", effort: "high" },
		});
		// then
		expect(reasoning).toEqual({ model: "gpt-5.6-terra", effort: "high" });
	});

	test("#given a preserved worker-medium sol/high default #when resolving against terra/high #then the chained upgrade lands on the new effort", () => {
		// when
		const reasoning = resolveManagedAgentReasoning({
			agentName: "lazycodex-worker-medium",
			bundledModel: "gpt-5.6-terra",
			bundledEffort: "high",
			preserved: { model: "gpt-5.6-sol", effort: "high" },
		});
		// then
		expect(reasoning).toEqual({ model: "gpt-5.6-terra", effort: "high" });
	});

	test("#given a preserved qa-executor luna/high default #when resolving against terra/medium #then the new bundled effort wins", () => {
		// when
		const reasoning = resolveManagedAgentReasoning({
			agentName: "lazycodex-qa-executor",
			bundledModel: "gpt-5.6-terra",
			bundledEffort: "medium",
			preserved: { model: "gpt-5.6-luna", effort: "high" },
		});
		// then
		expect(reasoning).toEqual({ model: "gpt-5.6-terra", effort: "medium" });
	});

	test("#given a preserved gate-reviewer sol/xhigh default #when resolving against sol/high #then the new bundled effort wins", () => {
		// when
		const reasoning = resolveManagedAgentReasoning({
			agentName: "lazycodex-gate-reviewer",
			bundledModel: "gpt-5.6-sol",
			bundledEffort: "high",
			preserved: { model: "gpt-5.6-sol", effort: "xhigh" },
		});
		// then
		expect(reasoning).toEqual({ model: "gpt-5.6-sol", effort: "high" });
	});

	test("#given a second resolve over already-migrated values #when resolving #then the result is stable", () => {
		// when - after migration the installed file reads terra/medium; resolving again must not flip anything
		const reasoning = resolveManagedAgentReasoning({
			agentName: "explorer",
			...bundled,
			preserved: { model: "gpt-5.6-terra", effort: "medium" },
		});
		// then
		expect(reasoning).toEqual({ model: "gpt-5.6-terra", effort: "medium" });
	});
});
