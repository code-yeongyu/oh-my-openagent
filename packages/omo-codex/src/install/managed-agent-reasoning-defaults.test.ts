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
			agentName: "custom-unlisted-agent",
			bundledModel: "gpt-5.6-sol",
			bundledEffort: "high",
			preserved: { model: "gpt-5.6-sol", effort: "medium" },
		})
		// then
		expect(effort).toBe("medium")
	})

	test("#given a preserved plan sol/max default #when resolving against sol/high #then the new bundled effort wins", () => {
		// when
		const effort = resolveManagedAgentReasoning({
			agentName: "plan",
			bundledModel: "gpt-5.6-sol",
			bundledEffort: "high",
			preserved: { model: "gpt-5.6-sol", effort: "max" },
		})
		// then
		expect(effort).toBe("high")
	})

	test("#given a preserved worker-medium luna/max default #when resolving against terra/high #then the new bundled effort wins", () => {
		// when
		const effort = resolveManagedAgentReasoning({
			agentName: "lazycodex-worker-medium",
			bundledModel: "gpt-5.6-terra",
			bundledEffort: "high",
			preserved: { model: "gpt-5.6-luna", effort: "max" },
		})
		// then
		expect(effort).toBe("high")
	})

	test("#given a preserved qa-executor terra/medium default #when resolving against luna/high #then the new bundled effort wins", () => {
		// when
		const effort = resolveManagedAgentReasoning({
			agentName: "lazycodex-qa-executor",
			bundledModel: "gpt-5.6-luna",
			bundledEffort: "high",
			preserved: { model: "gpt-5.6-terra", effort: "medium" },
		})
		// then
		expect(effort).toBe("high")
	})

	test("#given a preserved gate-reviewer sol/high default #when resolving against sol/low #then the new bundled effort wins", () => {
		// when
		const effort = resolveManagedAgentReasoning({
			agentName: "lazycodex-gate-reviewer",
			bundledModel: "gpt-5.6-sol",
			bundledEffort: "low",
			preserved: { model: "gpt-5.6-sol", effort: "high" },
		})
		// then
		expect(effort).toBe("low")
	})

	test("#given old high worker and reviewer defaults #when resolving #then each new bundled effort wins", () => {
		expect(resolveManagedAgentReasoning({
			agentName: "lazycodex-worker-high",
			bundledModel: "gpt-5.6-sol",
			bundledEffort: "medium",
			preserved: { model: "gpt-5.6-sol", effort: "max" },
		})).toBe("medium")
		expect(resolveManagedAgentReasoning({
			agentName: "lazycodex-code-reviewer",
			bundledModel: "gpt-5.6-terra",
			bundledEffort: "medium",
			preserved: { model: "gpt-5.6-sol", effort: "xhigh" },
		})).toBe("medium")
		expect(resolveManagedAgentReasoning({
			agentName: "lazycodex-clone-fidelity-reviewer",
			bundledModel: "gpt-5.6-terra",
			bundledEffort: "high",
			preserved: { model: "gpt-5.6-sol", effort: "xhigh" },
		})).toBe("high")
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
