import { describe, expect, test } from "bun:test"
import { TeamSpecSchema } from "../types"
import { validateSpec } from "./validator"

function spec(subagentType: string) {
  return TeamSpecSchema.parse({
    name: "project-members",
    leadAgentId: "lead",
    members: [
      { name: "lead", kind: "subagent_type", subagent_type: "sisyphus" },
      { name: "worker", kind: "subagent_type", subagent_type: subagentType },
    ],
  })
}

describe("deferred member validation", () => {
  test.each(["project-worker", "constructor", "toString", "__proto__"])(
    "rejects unknown %s by default but permits explicit runtime validation",
    (name) => {
      // given
      const candidate = spec(name)
      // when / then
      expect(() => validateSpec(candidate)).toThrow("Unknown subagent_type")
      expect(() => validateSpec(candidate, { allowUnknownSubagentTypes: true })).not.toThrow()
    },
  )

  test.each(["oracle", "librarian", "explore", "metis", "momus", "prometheus", "multimodal-looker"])(
    "still rejects protected built-in %s with runtime validation enabled",
    (name) => {
      // given / when / then
      expect(() => validateSpec(spec(name), { allowUnknownSubagentTypes: true })).toThrow()
    },
  )
})
