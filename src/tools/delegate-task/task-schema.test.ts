declare const require: (name: string) => any
const { describe, expect, test } = require("bun:test")
import { createDelegateTask } from "./tools"

	describe("createDelegateTask schema", () => {
	test("#given category arg #when tool is created #then category is constrained to available enum values", () => {
		//#given
		const toolDefinition = createDelegateTask({ manager: {} as never, client: {} as never, directory: "/tmp/test" })

		//#when
		const categorySchema = toolDefinition.args.category as unknown as {
			def: {
				type: string
				innerType: {
					def: { type: string }
					options: string[]
				}
			}
		}

		//#then
		expect(categorySchema.def.type).toBe("optional")
		expect(categorySchema.def.innerType.def.type).toBe("enum")
		expect(categorySchema.def.innerType.options).toContain("quick")
		expect(categorySchema.def.innerType.options).toContain("deep")
		expect(categorySchema.def.innerType.options).toContain("ultrabrain")
	})
})
