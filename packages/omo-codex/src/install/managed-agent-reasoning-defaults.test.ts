import { describe, expect, test } from "bun:test"

import { resolveManagedAgentReasoning } from "./managed-agent-reasoning-defaults"

describe("resolveManagedAgentReasoning", () => {
	const bundled = { bundledModel: "gpt-6-astra", bundledEffort: "low" }

	test.each([
		["explorer", "gpt-5.6-luna", "low", "low"],
		["librarian", "gpt-5.6-luna", "low", "low"],
		["metis", "gpt-5.6-sol", "high", "high"],
		["momus", "gpt-5.6-terra", "high", "high"],
		["plan", "gpt-5.6-sol", "high", "high"],
		["lazycodex-worker-low", "gpt-5.6-luna", "high", "high"],
		["lazycodex-worker-medium", "gpt-5.6-terra", "high", "high"],
		["lazycodex-worker-high", "gpt-5.6-sol", "medium", "medium"],
		["lazycodex-code-reviewer", "gpt-5.6-terra", "medium", "medium"],
		["lazycodex-clone-fidelity-reviewer", "gpt-5.6-terra", "high", "high"],
		["lazycodex-qa-executor", "gpt-5.6-luna", "high", "high"],
		["lazycodex-gate-reviewer", "gpt-5.6-sol", "low", "low"],
		["momus", "gpt-5.5", "xhigh", "high"],
		["momus", "gpt-5.6-sol", "ultra", "high"],
		["lazycodex-gate-reviewer", "gpt-5.6-sol", "xhigh", "low"],
	])("#given %s preserved at %s/%s #when resolving against Astra #then effort is %s", (agentName, model, effort, expected) => {
		expect(resolveManagedAgentReasoning({
			agentName,
			bundledModel: "gpt-6-astra",
			bundledEffort: expected,
			preserved: { model, effort },
		})).toBe(expected)
	})

	test.each([
		["momus", "gpt-5.6-terra", "high", "gpt-5.5", "xhigh"],
		["momus", "gpt-5.6-terra", "high", "gpt-5.6-sol", "ultra"],
		["explorer", "gpt-5.6-luna", "low", "gpt-5.6-terra", "medium"],
		["librarian", "gpt-5.6-luna", "low", "gpt-5.6-terra", "medium"],
		["plan", "gpt-5.6-sol", "high", "gpt-5.6-sol", "max"],
		["lazycodex-worker-medium", "gpt-5.6-terra", "high", "gpt-5.6-luna", "max"],
		["lazycodex-worker-high", "gpt-5.6-sol", "medium", "gpt-5.6-sol", "max"],
		["lazycodex-code-reviewer", "gpt-5.6-terra", "medium", "gpt-5.6-sol", "xhigh"],
		["lazycodex-clone-fidelity-reviewer", "gpt-5.6-terra", "high", "gpt-5.6-sol", "xhigh"],
		["lazycodex-qa-executor", "gpt-5.6-luna", "high", "gpt-5.6-terra", "medium"],
		["lazycodex-gate-reviewer", "gpt-5.6-sol", "low", "gpt-5.6-sol", "xhigh"],
	])("#given %s cached at %s/%s #when restoring %s/%s #then model-only upgrades retain effort migration", (agentName, bundledModel, bundledEffort, model, effort) => {
		expect(resolveManagedAgentReasoning({
			agentName, bundledModel, bundledEffort, preserved: { model, effort },
		})).toBe(bundledEffort)
	})

	test.each([
		["momus", "gpt-5.6-sol", "ultra", "gpt-5.5", "xhigh"],
		["explorer", "gpt-5.6-terra", "medium", "gpt-5.6-luna-fast", "low"],
		["lazycodex-gate-reviewer", "gpt-5.6-sol", "high", "gpt-5.6-sol", "xhigh"],
		["lazycodex-gate-reviewer", "gpt-5.5", "high", "gpt-5.5", "xhigh"],
		["momus", "custom-model", "high", "gpt-5.5", "xhigh"],
		["momus", "gpt-6-astra", "medium", "gpt-5.5", "xhigh"],
		["momus", "gpt-6-astra", "high", "custom-model", "xhigh"],
		["momus", "gpt-5.6-terra", "high", "gpt-5.6-sol", "xhigh"],
	])("#given %s bundled at %s/%s with preserved %s/%s #when a pair is non-current or customized #then keeps the effort", (agentName, bundledModel, bundledEffort, model, effort) => {
		expect(resolveManagedAgentReasoning({
			agentName, bundledModel, bundledEffort, preserved: { model, effort },
		})).toBe(effort)
	})

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

	test("#given a preserved gpt-5.6-luna-fast/low default #when resolving #then the chained upgrade still lands on the new effort", () => {
		// when
		const effort = resolveManagedAgentReasoning({
			agentName: "librarian",
			...bundled,
			preserved: { model: "gpt-5.6-luna-fast", effort: "low" },
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
			bundledModel: "gpt-6-astra",
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
			bundledModel: "gpt-6-astra",
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
			bundledModel: "gpt-6-astra",
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
			bundledModel: "gpt-6-astra",
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
			bundledModel: "gpt-6-astra",
			bundledEffort: "low",
			preserved: { model: "gpt-5.6-sol", effort: "high" },
		})
		// then
		expect(effort).toBe("low")
	})

	test("#given old high worker and reviewer defaults #when resolving #then each new bundled effort wins", () => {
		expect(resolveManagedAgentReasoning({
			agentName: "lazycodex-worker-high",
			bundledModel: "gpt-6-astra",
			bundledEffort: "medium",
			preserved: { model: "gpt-5.6-sol", effort: "max" },
		})).toBe("medium")
		expect(resolveManagedAgentReasoning({
			agentName: "lazycodex-code-reviewer",
			bundledModel: "gpt-6-astra",
			bundledEffort: "medium",
			preserved: { model: "gpt-5.6-sol", effort: "xhigh" },
		})).toBe("medium")
		expect(resolveManagedAgentReasoning({
			agentName: "lazycodex-clone-fidelity-reviewer",
			bundledModel: "gpt-6-astra",
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
