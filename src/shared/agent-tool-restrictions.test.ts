import { describe, expect, test } from "bun:test"
import { ATHENA_JUNIOR_COUNCIL_MEMBER_KEY_PREFIX, COUNCIL_MEMBER_KEY_PREFIX } from "../agents/builtin-agents/council-member-agents"
import { getAgentToolRestrictions } from "./agent-tool-restrictions"

describe("agent-tool-restrictions", () => {
  test("athena restrictions include call_omo_agent", () => {
    //#given
    //#when
    const restrictions = getAgentToolRestrictions("athena")
    //#then
    expect(restrictions.call_omo_agent).toBe(false)
  })

  test("council-member restrictions keep delegation tooling enabled", () => {
    //#given
    //#when
    const restrictions = getAgentToolRestrictions("council-member")
    //#then
    // Wildcard deny key
    expect(restrictions["*"]).toBe(false)
    // Explicitly allowed tools
    expect(restrictions.read).toBe(true)
    expect(restrictions.grep).toBe(true)
    expect(restrictions.finish_task).toBeUndefined()
    expect(restrictions.call_omo_agent).toBe(true)
    expect(restrictions.background_output).toBe(true)
    expect(restrictions.background_wait).toBe(true)
    expect(restrictions.background_cancel).toBe(true)
    // Explicitly denied tools
    expect(restrictions.todowrite).toBe(false)
    expect(restrictions.todoread).toBe(false)
    // Unlisted tools are undefined (SDK applies wildcard at runtime)
    expect(restrictions.switch_agent).toBeUndefined()
  })

  test("#given dynamic council member name #when getAgentToolRestrictions #then returns council-member restrictions", () => {
    //#given
    const dynamicName = `${COUNCIL_MEMBER_KEY_PREFIX}Claude Opus 4.6`
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
    expect(restrictions.background_wait).toBe(true)
    expect(restrictions.background_cancel).toBe(true)
    // Explicitly denied tools
    expect(restrictions.todowrite).toBe(false)
    expect(restrictions.todoread).toBe(false)
    // Unlisted tools are undefined (SDK applies wildcard at runtime)
    expect(restrictions.switch_agent).toBeUndefined()
    expect(restrictions.write).toBeUndefined()
    expect(restrictions.edit).toBeUndefined()
    expect(restrictions.task).toBeUndefined()
  })

  test("#given Athena-Junior council member name #when getAgentToolRestrictions #then returns solo runtime restrictions", () => {
    //#given
    const dynamicName = `${ATHENA_JUNIOR_COUNCIL_MEMBER_KEY_PREFIX}Claude Opus 4.6`
    //#when
    const restrictions = getAgentToolRestrictions(dynamicName)
    //#then
    expect(restrictions["*"]).toBe(false)
    expect(restrictions.finish_task).toBe(true)
    expect(restrictions.background_wait).toBe(true)
    expect(restrictions.read).toBe(false)
    expect(restrictions.call_omo_agent).toBe(false)
    expect(restrictions.background_output).toBe(false)
    expect(restrictions.background_cancel).toBe(false)
  })
})
