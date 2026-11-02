import { describe, expect, test } from "bun:test"

import { createSessionToolPermissionLookup } from "./session-tool-permissions"
import type { PluginContext } from "./types"

function createLookup(responses: Array<"ok" | "fail">) {
  const reads: string[] = []
  const ctx = {
    directory: "/workspace",
    client: { session: { get: async ({ path }: { path: { id: string } }) => {
      reads.push(path.id)
      if (responses.shift() === "fail") throw new Error("Session metadata unavailable")
      return { data: { permission: [{ permission: "question", pattern: "*", action: "deny" }] } }
    } } },
  } as unknown as PluginContext
  return { ...createSessionToolPermissionLookup(ctx), reads }
}

describe("session tool permission lookup", () => {
  test("a deleted session is read again on its next request", async () => {
    const { lookup, observe, reads } = createLookup(["ok", "ok"])
    await lookup("ses")
    observe({ event: { type: "session.deleted", properties: { info: { id: "ses" } } } })
    await lookup("ses")
    expect(reads).toEqual(["ses", "ses"])
  })

  test("a failed read is not cached, so the next request retries", async () => {
    const { lookup, reads } = createLookup(["fail", "ok"])
    expect(await lookup("ses")).toBeUndefined()
    expect(await lookup("ses")).toEqual([{ pattern: "question", permission: "deny", scope: "*" }])
    expect(reads).toEqual(["ses", "ses"])
  })
})
