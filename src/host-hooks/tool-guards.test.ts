import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { registerTargetToolGuards, type TargetToolGuardApi } from "./tool-guards"

let cwd: string

beforeEach(() => {
  cwd = mkdtempSync(join(tmpdir(), "omo-target-guards-"))
})

afterEach(() => {
  rmSync(cwd, { recursive: true, force: true })
})

function setup(checkComments = async () => ({ hasComments: false, message: "" })) {
  const handlers = new Map<string, (event: never, context: { cwd: string }) => unknown | Promise<unknown>>()
  const api = {
    on: (event: string, handler: (event: never, context: { cwd: string }) => unknown | Promise<unknown>) => handlers.set(event, handler),
  } as TargetToolGuardApi
  registerTargetToolGuards(api, { cwd, checkComments })
  return handlers
}

describe("target tool guards", () => {
  test("#given simple bash file read #when tool call fires #then guard blocks it", async () => {
    const result = await setup().get("tool_call")?.(
      { toolName: "bash", toolCallId: "bash-1", input: { command: "cat file.ts" } } as never,
      { cwd },
    )
    expect(result).toEqual({ block: true, reason: "Prefer the Read tool for file contents so line anchors remain available." })
  })

  test("#given existing unread file #when write fires #then guard blocks until read", async () => {
    const path = join(cwd, "existing.ts")
    writeFileSync(path, "old")
    const handlers = setup()
    const blocked = await handlers.get("tool_call")?.(
      { toolName: "write", toolCallId: "write-1", input: { path, content: "new" } } as never,
      { cwd },
    )
    await handlers.get("tool_call")?.({ toolName: "read", toolCallId: "read-1", input: { path } } as never, { cwd })
    const allowed = await handlers.get("tool_call")?.(
      { toolName: "write", toolCallId: "write-2", input: { path, content: "new" } } as never,
      { cwd },
    )
    expect(blocked).toEqual({ block: true, reason: "File already exists. Read it first or use edit." })
    expect(allowed).toBeUndefined()
  })

  test("#given successful mutation #when tool result fires #then comment checker message mutates result", async () => {
    const handlers = setup(async () => ({ hasComments: true, message: "Remove narration comment." }))
    await handlers.get("tool_call")?.(
      { toolName: "edit", toolCallId: "edit-1", input: { path: "file.ts", old_string: "a", new_string: "b" } } as never,
      { cwd },
    )
    const result = await handlers.get("tool_result")?.(
      { toolName: "edit", toolCallId: "edit-1", input: {}, content: [{ type: "text", text: "done" }], isError: false } as never,
      { cwd },
    )
    expect(result).toEqual({
      content: [{ type: "text", text: "done" }, { type: "text", text: "Remove narration comment." }],
    })
  })
})
