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
})
