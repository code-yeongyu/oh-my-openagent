import { describe, expect, it } from "bun:test"
import type { GitCommitAuthor } from "../git"
import { describeRepairs, repairLeakedArguments } from "./leaked-arguments"
import type { MemoryToolParams } from "./memory"

const AUTHOR: GitCommitAuthor = { agentId: "agent", authorName: "Agent", authorEmail: "agent@example.com" }

function params(overrides: Partial<MemoryToolParams>): MemoryToolParams {
  return { command: "create", reason: "r", author: AUTHOR, ...overrides }
}

describe("repairLeakedArguments", () => {
  it("#given a well-formed call #when repaired #then the same params come back with no repairs", () => {
    const input = params({ file_path: "reference/a.md", description: "Summary", file_text: "body" })

    const { params: output, repairs } = repairLeakedArguments(input)

    expect(output).toBe(input)
    expect(repairs).toEqual([])
  })

  it("#given file_text inside description #when repaired #then both get their intended values", () => {
    const input = params({ description: 'Summary</description>\n<parameter name="file_text"># Title\nbody\n' })

    const { params: output, repairs } = repairLeakedArguments(input)

    expect(output.description).toBe("Summary")
    expect(output.file_text).toBe("# Title\nbody\n")
    expect(repairs).toEqual([{ from: "description", to: "file_text" }])
  })

  it("#given the same mistake twice in a row #when repaired #then the chain is split at each closing tag", () => {
    const input = params({
      command: "str_replace",
      file_path: "reference/a.md",
      old_string: 'old</old_string> <parameter name="new_string">new</new_string><parameter name="insert_text">tail',
    })

    const { params: output, repairs } = repairLeakedArguments(input)

    expect(output.old_string).toBe("old")
    expect(output.new_string).toBe("new")
    expect(output.insert_text).toBe("tail")
    expect(repairs).toEqual([{ from: "old_string", to: "new_string" }, { from: "new_string", to: "insert_text" }])
  })

  it.each([
    ["the leaked argument was also sent", { description: 'S</description><parameter name="file_text">x', file_text: "y" }],
    ["the leaked argument is unknown", { description: 'S</description><parameter name="body">x' }],
    ["the closing tag names another argument", { description: 'S</file_text><parameter name="file_text">x' }],
    ["the leak names its own argument", { description: 'S</description><parameter name="description">x' }],
  ])("#given %s #when repaired #then the call is left as sent", (_case, overrides) => {
    const input = params(overrides)

    const { params: output, repairs } = repairLeakedArguments(input)

    expect(output).toBe(input)
    expect(repairs).toEqual([])
  })
})

describe("describeRepairs", () => {
  it("#given no repairs #then nothing is added to the tool result", () => {
    expect(describeRepairs([])).toBe("")
  })

  it("#given a repair #then the note names both arguments and the closing tag to use", () => {
    expect(describeRepairs([{ from: "description", to: "file_text" }])).toBe(
      "\nNote: 'file_text' arrived inside 'description' because 'description' was closed with </description> instead of </parameter>; it was split back out before writing.",
    )
  })
})
