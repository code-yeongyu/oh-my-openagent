import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { computeLineHash } from "../tools/hashline-edit/hash-computation"
import { registerHashlineEditTool } from "./hashline-edit-tool"
import type { TargetToolDefinition } from "./tool-registration"

let tempDirectory: string

beforeEach(() => {
  tempDirectory = mkdtempSync(join(tmpdir(), "omo-hashline-target-"))
})

afterEach(() => {
  rmSync(tempDirectory, { recursive: true, force: true })
})

function getText(result: { content: readonly Array<{ type: string; text?: string }> }): string {
  const first = result.content[0]
  if (!first || first.type !== "text" || typeof first.text !== "string") {
    throw new Error("expected text tool result")
  }
  return first.text
}

function registerTool(host: "oh-my-pi" | "pi" = "oh-my-pi"): TargetToolDefinition {
  let registeredTool: TargetToolDefinition | undefined
  registerHashlineEditTool({
    host,
    cwd: tempDirectory,
    registry: {
      registerTool: (tool) => {
        registeredTool = tool
      },
    },
  })
  if (!registeredTool) throw new Error("hashline edit tool was not registered")
  return registeredTool
}

describe("registerHashlineEditTool", () => {
  test("#given target registry #when registering hashline edit #then edit tool is present", () => {
    // given
    const tool = registerTool("pi")

    // then
    expect(tool.name).toBe("edit")
    expect(tool.label).toBe("edit")
    expect(tool.description).toContain("LINE#ID")
  })

  test("#given valid hash anchor #when executing target edit #then file is updated", async () => {
    // given
    const filePath = join(tempDirectory, "target.txt")
    writeFileSync(filePath, "one\ntwo\nthree", "utf-8")
    const lineTwoHash = computeLineHash(2, "two")
    const tool = registerTool()

    // when
    const result = await tool.execute("call-1", {
      filePath,
      edits: [{ op: "replace", pos: `2#${lineTwoHash}`, lines: "TWO" }],
    })

    // then
    expect(result.isError).toBeUndefined()
    expect(getText(result)).toBe(`Updated ${filePath}`)
    expect(readFileSync(filePath, "utf-8")).toBe("one\nTWO\nthree")
  })

  test("#given stale hash anchor #when executing target edit #then file is unchanged and result is error", async () => {
    // given
    const filePath = join(tempDirectory, "target.txt")
    writeFileSync(filePath, "one\ntwo\nthree", "utf-8")
    const tool = registerTool("pi")

    // when
    const result = await tool.execute("call-1", {
      filePath,
      edits: [{ op: "replace", pos: "2#ZZ", lines: "stale" }],
    })

    // then
    expect(result.isError).toBe(true)
    expect(getText(result)).toContain("hash mismatch")
    expect(getText(result)).toContain(">>>")
    expect(readFileSync(filePath, "utf-8")).toBe("one\ntwo\nthree")
  })
})
