import { describe, expect, spyOn, test } from "bun:test"
import { createBuiltinAgents } from "./builtin-agents"
import * as shared from "../shared"

const TEST_DEFAULT_MODEL = "anthropic/claude-opus-4-6"

describe("createBuiltinAgents custom agent visibility", () => {
	test("#given runtime custom agents #when orchestrator prompts are built #then custom agents are not advertised for automatic delegation", async () => {
		//#given
		const fetchSpy = spyOn(shared, "fetchAvailableModels").mockResolvedValue(
			new Set(["anthropic/claude-opus-4-6", "openai/gpt-5.4"])
		)

		try {
			//#when
			const agents = await createBuiltinAgents(
				[],
				{},
				undefined,
				TEST_DEFAULT_MODEL,
				undefined,
				undefined,
				[],
				[
					{
						name: "backend-engineer",
						description: "Custom backend specialist",
					},
				]
			)

			//#then
			expect(agents.sisyphus.prompt).not.toContain("backend-engineer")
			expect(agents.hephaestus.prompt).not.toContain("backend-engineer")
			expect(agents.atlas.prompt).not.toContain("backend-engineer")
		} finally {
			fetchSpy.mockRestore()
		}
	})
})
