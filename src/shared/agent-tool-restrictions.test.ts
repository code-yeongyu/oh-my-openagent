import { describe, expect, test } from "bun:test"
import { getAgentToolRestrictions } from "./agent-tool-restrictions"

describe("agent-tool-restrictions", () => {
  test("athena restrictions include call_omo_agent", () => {
    //#given
    //#when
    const restrictions = getAgentToolRestrictions("athena")
    //#then
    expect(restrictions.write).toBe(false)
    expect(restrictions.edit).toBe(false)
    expect(restrictions.call_omo_agent).toBe(false)
  })

  test("council-member restrictions include all denied tools", () => {
    //#given
    //#when
    const restrictions = getAgentToolRestrictions("council-member")
    //#then
    // Wildcard deny key
    expect(restrictions["*"]).toBe(false)
    // Explicitly allowed tools
    expect(restrictions.read).toBe(true)
    expect(restrictions.grep).toBe(true)
    expect(restrictions.call_omo_agent).toBe(true)
    expect(restrictions.background_output).toBe(true)
    // Explicitly denied tools
    expect(restrictions.todowrite).toBe(false)
    expect(restrictions.todoread).toBe(false)
    // Unlisted tools are undefined (SDK applies wildcard at runtime)
    expect(restrictions.switch_agent).toBeUndefined()
    expect(restrictions.background_wait).toBeUndefined()
  })

  test("#given dynamic council member name #when getAgentToolRestrictions #then returns council-member restrictions", () => {
    //#given
    const dynamicName = "Council: Claude Opus 4.6"
    //#when
    const restrictions = getAgentToolRestrictions(dynamicName)
    //#then
    // Wildcard deny key
    expect(restrictions["*"]).toBe(false)
    // Explicitly allowed tools
    expect(restrictions.read).toBe(true)
    expect(restrictions.grep).toBe(true)
    expect(restrictions.call_omo_agent).toBe(true)
    expect(restrictions.background_output).toBe(true)
    // Explicitly denied tools
    expect(restrictions.todowrite).toBe(false)
    expect(restrictions.todoread).toBe(false)
    // Unlisted tools are undefined (SDK applies wildcard at runtime)
    expect(restrictions.switch_agent).toBeUndefined()
    expect(restrictions.write).toBeUndefined()
    expect(restrictions.edit).toBeUndefined()
    expect(restrictions.task).toBeUndefined()
    expect(restrictions.background_wait).toBeUndefined()
  })
})
