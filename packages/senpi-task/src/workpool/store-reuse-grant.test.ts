import { afterEach, describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createWorkpoolStore } from "./store"
import type { WorkpoolSpec } from "./types"

const roots: string[] = []
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })

function setup() {
  const root = mkdtempSync(join(tmpdir(), "senpi-workpool-reuse-"))
  roots.push(root)
  const store = createWorkpoolStore(root)
  const caller = { sessionId: "parent", rootSessionId: "parent", depth: 0, cwd: root }
  const agent = { category: "quick", prompt: "Process input" }
  const spec: WorkpoolSpec = {
    plan: { model: "test/model" },
    start: { prompt: "Process input", parent_session_id: "parent", root_session_id: "parent", depth: 1, cwd: root, category: "quick", execution_mode: "in-process" },
  }
  const create = (tools?: readonly string[]) =>
    store.create(caller, { name: "batch", agent, mode: "fresh", ...(tools === undefined ? {} : { tools }) }, spec)
  return { create }
}

describe("a pool name reused by the same parent session", () => {
  test("#given a pool granted one tool #when a later create of the same name asks for a different tool #then it is refused, not handed the first grant", () => {
    const { create } = setup()
    create(["secret"])

    expect(() => create(["other"])).toThrow(expect.objectContaining({ code: "pool_name_conflict" }))
  })

  test("#given a pool granted a tool #when a later create is refused #then the refusal does not reveal the existing pool's tools", () => {
    const { create } = setup()
    create(["secret_tool"])

    let message = ""
    try { create(["other"]) } catch (error) { message = error instanceof Error ? error.message : String(error) }

    expect(message).not.toBe("")
    expect(message).not.toContain("secret_tool")
  })

  test("#given a pool granted a tool #when a later create of the same name asks for no tools #then it is refused, not handed the first grant", () => {
    const { create } = setup()
    create(["secret"])

    expect(() => create()).toThrow(expect.objectContaining({ code: "pool_name_conflict" }))
  })

  test("#given a pool without tools #when a later create of the same name asks for a tool #then it is refused, never silently widened", () => {
    const { create } = setup()
    create()

    expect(() => create(["secret"])).toThrow(expect.objectContaining({ code: "pool_name_conflict" }))
  })

  test("#given a pool granted tools #when the same grant is asked again in another order #then the same pool is reused", () => {
    const { create } = setup()
    const first = create(["a", "b"])

    expect(create(["b", "a"]).pool_id).toBe(first.pool_id)
  })

  test("#given a pool without tools #when it is asked again with an empty grant #then the same pool is reused", () => {
    const { create } = setup()
    const first = create()

    expect(create([]).pool_id).toBe(first.pool_id)
  })
})
