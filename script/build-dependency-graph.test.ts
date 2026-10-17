import { describe, expect, test } from "bun:test"
import { BUILD_NODES, selectBuildNodes } from "./build-nodes"

describe("build dependency graph", () => {
	test("#given Codex and Senpi share plugin dependencies #when scheduled #then Codex installation completes first", () => {
		const senpiNode = BUILD_NODES.find((node) => node.id === "senpi-plugin")

		expect(senpiNode?.deps).toContain("codex-plugin")
	})

	test("#given a default build #when the graph is selected #then the Senpi node is scheduled with its Codex dependency", () => {
		const selected = selectBuildNodes(BUILD_NODES, undefined)
		const senpiNode = selected.find((node) => node.id === "senpi-plugin")

		expect(senpiNode).toBeDefined()
		expect(selected.map((node) => node.id)).toContain("codex-plugin")
	})
})
