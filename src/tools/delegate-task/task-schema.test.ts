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
		const categorySchema = toolDefinition.args.category as unknown as {
			def: {
				type: string
				innerType: {
					def: { type: string }
				}
			}
		}

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
		expect(description).toContain("task_id: Existing task to continue")
		expect(description).not.toContain("sisyphus")
		expect(description).not.toContain("hephaestus")
		expect(description).not.toContain("prometheus")
	})

	test("#given no availableSubagentNames #when tool is created #then subagent_type is plain string (back-compat)", () => {
		//#given
		const toolDefinition = createDelegateTask({ manager: {} as never, client: {} as never, directory: "/tmp/test" })

		//#when
		const subagentSchema = toolDefinition.args.subagent_type as unknown as {
			def: { type: string; innerType: { def: { type: string } } }
		}

		//#then
		expect(subagentSchema.def.type).toBe("optional")
		expect(subagentSchema.def.innerType.def.type).toBe("string")
	})

	test("#given availableSubagentNames option #when tool is created #then subagent_type emits enum with those names", () => {
		//#given
		const toolDefinition = createDelegateTask({
			manager: {} as never,
			client: {} as never,
			directory: "/tmp/test",
			availableSubagentNames: ["oracle", "librarian", "dev"],
		})

		//#when
		const subagentSchema = toolDefinition.args.subagent_type as unknown as {
			def: {
				type: string
				innerType: {
					def: {
						type: string
						entries?: Record<string, string>
						values?: string[]
					}
				}
			}
		}

		//#then
		expect(subagentSchema.def.type).toBe("optional")
		expect(subagentSchema.def.innerType.def.type).toBe("enum")
		const inner = subagentSchema.def.innerType.def
		const values = inner.entries ? Object.values(inner.entries) : (inner.values ?? [])
		expect(values).toContain("oracle")
		expect(values).toContain("librarian")
		expect(values).toContain("dev")
	})

	test("#given empty availableSubagentNames #when tool is created #then subagent_type stays plain string", () => {
		//#given
		const toolDefinition = createDelegateTask({
			manager: {} as never,
			client: {} as never,
			directory: "/tmp/test",
			availableSubagentNames: [],
		})

		//#when
		const subagentSchema = toolDefinition.args.subagent_type as unknown as {
			def: { type: string; innerType: { def: { type: string } } }
		}

		//#then
		expect(subagentSchema.def.type).toBe("optional")
		expect(subagentSchema.def.innerType.def.type).toBe("string")
	})
})

export {}
