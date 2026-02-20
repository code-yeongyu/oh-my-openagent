import { describe, expect, test } from "bun:test"
import {
  getAgentToolRestrictions,
  hasAgentToolRestrictions,
} from "./agent-tool-restrictions"

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
    expect(restrictions.call_omo_agent).toBe(false)
    expect(restrictions.switch_agent).toBe(false)
    expect(restrictions.background_wait).toBe(false)
  })

  test("#given dynamic council member name #when getAgentToolRestrictions #then returns council-member restrictions", () => {
    //#given
    const dynamicName = "Council: Claude Opus 4.6"
    //#when
    const restrictions = getAgentToolRestrictions(dynamicName)
    //#then
    expect(restrictions.write).toBe(false)
    expect(restrictions.edit).toBe(false)
    expect(restrictions.task).toBe(false)
    expect(restrictions.call_omo_agent).toBe(false)
    expect(restrictions.switch_agent).toBe(false)
    expect(restrictions.background_wait).toBe(false)
  })

  test("hasAgentToolRestrictions returns true for athena", () => {
    //#given
    //#when
    const result = hasAgentToolRestrictions("athena")
    //#then
    expect(result).toBe(true)
  })
})
