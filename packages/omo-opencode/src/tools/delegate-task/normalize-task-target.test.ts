declare const require: (name: string) => any
const { describe, expect, test } = require("bun:test")
import {
  applyExclusiveTaskTarget,
  normalizeExclusiveTaskTarget,
} from "./normalize-task-target"

describe("normalizeExclusiveTaskTarget (#7920)", () => {
  test("#given @explore both category and subagent_type #when normalized #then only subagent_type remains", () => {
    //#given
    const input = { category: "explore", subagent_type: "explore" }

    //#when
    const result = normalizeExclusiveTaskTarget(input)

    //#then
    expect(result).toEqual({ subagent_type: "explore" })
    expect(result.category).toBeUndefined()
  })

  test("#given category=explore only #when normalized #then it becomes subagent_type=explore", () => {
    //#given / #when
    const result = normalizeExclusiveTaskTarget({ category: "explore" })

    //#then
    expect(result).toEqual({ subagent_type: "explore" })
  })

  test("#given quoted explore category #when normalized #then quotes are stripped and category is dropped", () => {
    //#given / #when
    const result = normalizeExclusiveTaskTarget({ category: "'explore'" })

    //#then
    expect(result).toEqual({ subagent_type: "explore" })
  })

  test("#given a real category plus explore #when normalized #then category still wins", () => {
    //#given / #when
    const result = normalizeExclusiveTaskTarget({ category: "quick", subagent_type: "explore" })

    //#then
    expect(result).toEqual({ category: "quick", subagent_type: "Sisyphus-Junior" })
  })

  test("#given applyExclusiveTaskTarget #when category must be omitted #then the key is deleted not set undefined", () => {
    //#given
    const args = { category: "explore", subagent_type: "explore", prompt: "hello" }

    //#when
    const next = applyExclusiveTaskTarget(args, { subagent_type: "explore" })

    //#then
    expect("category" in next).toBe(false)
    expect(next.subagent_type).toBe("explore")
    expect(next.prompt).toBe("hello")
  })
})
