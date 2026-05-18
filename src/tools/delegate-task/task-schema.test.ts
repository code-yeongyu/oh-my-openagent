import { unsafeTestValue } from "../../../test-support/unsafe-test-value"
const { describe, expect, test } = require("bun:test")

function requireFresh<T>(modulePath: string): T {
  const resolvedPath = require.resolve(modulePath)
  if (require.cache?.[resolvedPath]) {
    delete require.cache[resolvedPath]
  }
  return require(modulePath) as T
}

function createDelegateTask(...args: Parameters<typeof import("./tools").createDelegateTask>): ReturnType<typeof import("./tools").createDelegateTask> {
  return requireFresh<typeof import("./tools")>("./tools").createDelegateTask(...args)
}

	describe("createDelegateTask schema", () => {
	test("#given category arg #when tool is created #then category accepts any string", () => {
		//#given
		const toolDefinition = createDelegateTask({ manager: {} as never, client: {} as never, directory: "/tmp/test" })

		//#when
		const categorySchema = unsafeTestValue<{
			def: {
				type: string
				innerType: {
					def: { type: string }
				}
			}
		}>(toolDefinition.args.category)

		//#then
		expect(categorySchema.def.type).toBe("optional")
		expect(categorySchema.def.innerType.def.type).toBe("string")
	})

	test("#given task description #when tool is created #then primary agents are not advertised for subagent_type", () => {
		//#given
		const toolDefinition = createDelegateTask({ manager: {} as never, client: {} as never, directory: "/tmp/test" })

		//#when
		const description = toolDefinition.description

		//#then
		expect(description).toContain("subagent_type: Use specific agent directly")
		expect(description).toContain("task_id: Continuation session id")
		expect(description).not.toContain("sisyphus")
		expect(description).not.toContain("hephaestus")
		expect(description).not.toContain("prometheus")
	})

	test("#given task schema #when describing async mode #then it names background task ids explicitly", () => {
		//#given
		const toolDefinition = createDelegateTask({ manager: {} as never, client: {} as never, directory: "/tmp/test" })

		//#when
		const runInBackgroundSchema = unsafeTestValue<{ description?: string }>(toolDefinition.args.run_in_background)

		//#then
		expect(runInBackgroundSchema.description).toContain("background task ID")
		expect(runInBackgroundSchema.description).toContain("bg_")
		expect(runInBackgroundSchema.description).toContain("background_output")
		expect(runInBackgroundSchema.description).not.toContain("returns task_id")
	})
})

export {}
