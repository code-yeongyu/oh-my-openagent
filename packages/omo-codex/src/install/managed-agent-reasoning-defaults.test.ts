import { describe, expect, test } from "bun:test"

import { resolveManagedAgentReasoning } from "./managed-agent-reasoning-defaults"

describe("resolveManagedAgentReasoning", () => {
	// given the explorer bundled defaults moved terra/medium -> luna/low
	const bundled = { bundledModel: "gpt-5.6-luna", bundledEffort: "low" }

	test("#given a preserved terra/medium default #when resolving #then the new bundled effort wins", () => {
		// when
		const effort = resolveManagedAgentReasoning({
			agentName: "explorer",
			...bundled,
			preserved: { model: "gpt-5.6-terra", effort: "medium" },
		})
		// then
		expect(effort).toBe("low")
	})

	test("#given a preserved gpt-5.4-mini/low default #when resolving #then the chained upgrade still lands on the new effort", () => {
		// when
		const effort = resolveManagedAgentReasoning({
			agentName: "librarian",
			...bundled,
			preserved: { model: "gpt-5.4-mini", effort: "low" },
		})
		// then
		expect(effort).toBe("low")
	})

	test("#given a user-customized effort #when resolving #then the customization is preserved", () => {
		// when
		const effort = resolveManagedAgentReasoning({
			agentName: "explorer",
			...bundled,
			preserved: { model: "gpt-5.6-terra", effort: "xhigh" },
		})
		// then
		expect(effort).toBe("xhigh")
	})

	test("#given an unlisted agent #when resolving #then the preserved effort is untouched", () => {
		// when
		const effort = resolveManagedAgentReasoning({
			agentName: "plan",
			bundledModel: "gpt-5.6-sol",
			bundledEffort: "xhigh",
			preserved: { model: "gpt-5.6-sol", effort: "medium" },
		})
		// then
		expect(effort).toBe("medium")
	})

	test("#given a second resolve over already-migrated values #when resolving #then the result is stable", () => {
		// when — after migration the installed file reads luna/low; resolving again must not flip anything
		const effort = resolveManagedAgentReasoning({
			agentName: "explorer",
			...bundled,
			preserved: { model: "gpt-5.6-luna", effort: "low" },
		})
		// then
		expect(effort).toBe("low")
	})
})
