declare const require: (name: string) => any
const { describe, expect, test } = require("bun:test")
import { prepareDelegateTaskArgs } from "./tool-argument-preparation"

function createCtx(): { metadata: (input: { title?: string }) => Promise<void> } {
  return {
    metadata: async () => {},
  }
}

describe("prepareDelegateTaskArgs exclusive task target (#7920)", () => {
  test("#given @explore mention with both category and subagent_type #when args are prepared #then only subagent_type=explore is passed", async () => {
    //#given
    const args = {
      category: "explore",
      subagent_type: "explore",
      prompt: "hello",
      description: "Explore hello",
      run_in_background: false,
      load_skills: [],
    }

    //#when
    const prepared = await prepareDelegateTaskArgs(args, createCtx())

    //#then — OpenCode task() rejects both; @explore must keep the named agent
    expect(prepared.category).toBeUndefined()
    expect(prepared.subagent_type).toBe("explore")
    expect(prepared.requested_subagent_type).toBe("explore")
  })

  test("#given category=explore without subagent_type #when args are prepared #then category is rewritten to subagent_type only", async () => {
    //#given
    const args = {
      category: "explore",
      prompt: "hello",
      run_in_background: false,
      load_skills: [],
    }

    //#when
    const prepared = await prepareDelegateTaskArgs(args, createCtx())

    //#then
    expect(prepared.category).toBeUndefined()
    expect(prepared.subagent_type).toBe("explore")
  })

  test("#given a real category plus subagent_type=explore #when args are prepared #then category still wins", async () => {
    //#given
    const args = {
      category: "quick",
      subagent_type: "explore",
      prompt: "Do something",
      description: "Override test",
      run_in_background: true,
      load_skills: [],
    }

    //#when
    const prepared = await prepareDelegateTaskArgs(args, createCtx())

    //#then
    expect(prepared.category).toBe("quick")
    expect(prepared.subagent_type).toBe("Sisyphus-Junior")
    expect(prepared.requested_subagent_type).toBe("explore")
  })
})
