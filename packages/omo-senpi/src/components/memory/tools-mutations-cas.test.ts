import { expect, test } from "bun:test"
import { existsSync } from "node:fs"
import { readFile } from "node:fs/promises"
import { join } from "node:path"
import { renderMemoryFile } from "@oh-my-opencode/memory-core"
import { FakeExtensionAPI } from "../../../test-support/fake-extension-api"
import { createMemoryIdentityContext } from "./context"
import { registerMemoryGuard } from "./guard"
import { componentContext } from "./memory.test-support"
import { createMemoryTools } from "./tools"
import { boundFixture, git, seedFile, textOf } from "./tools.test-support"
import { sessionIdFrom } from "./wiring-context"

const file_path = "reference/history/nested/notes.md"
const new_path = "reference/archive/notes.md"
const cases = [
  ["delete", { command: "delete", file_path }, null],
  ["recursive delete", { command: "delete", file_path: "reference/history" }, null],
  ["rename", { command: "rename", old_path: file_path, new_path }, new_path],
  ["update_description", { command: "update_description", file_path, description: "Session A" }, file_path],
] as const

for (const [name, mutation, finalPath] of cases) {
  test(`${name} refuses a stale session and succeeds after re-reading`, async () => {
    const fixture = await boundFixture()
    await seedFile(fixture, file_path, "original body")
    const sessionB = createMemoryIdentityContext(fixture.context)
    const resolve = (id?: string) => (id === "A" ? fixture.context : sessionB)
    const context = (id: string) => ({ sessionManager: { getSessionId: () => id } })
    const pi = new FakeExtensionAPI()
    registerMemoryGuard(pi, componentContext(), { getContext: (ctx) => resolve(sessionIdFrom(ctx)) })
    const [tool] = createMemoryTools(resolve)
    const path = join(fixture.repo.dir, file_path)
    const destination = join(fixture.repo.dir, new_path)
    const readAsA = async (toolCallId: string) => {
      const call = { toolCallId, toolName: "read", input: { path } }
      await pi.dispatch("tool_call", call, context("A"))
      const content = [{ type: "text", text: await readFile(path, "utf8") }]
      await pi.dispatch("tool_result", { ...call, isError: false, content }, context("A"))
    }
    const execute = (id: string, callId: string, params: Omit<Parameters<typeof tool.execute>[1], "reason">) =>
      tool.execute(callId, { ...params, reason: callId }, undefined, undefined, context(id))

    await readAsA("original")
    const winner = await execute("B", "write newer note", {
      command: "apply_patch",
      input: [
        "*** Begin Patch",
        `*** Update File: ${file_path}`,
        "@@",
        "-description: Seed",
        "+description: Session B",
        " ---",
        "-original body",
        "+newer body",
        "*** End Patch",
      ].join("\n"),
    })
    expect(winner.isError).toBeUndefined()
    const head = await fixture.repo.head()
    const newer = renderMemoryFile({ description: "Session B" }, "newer body")
    expect(await readFile(path, "utf8")).toBe(newer)

    const stale = await execute("A", "stale mutation", mutation)
    expect(stale.details.errorCode).toBe("stale_read")
    expect(stale.isError).toBe(true)
    expect(stale.details.message).toContain(path)
    expect(textOf(stale)).toBe(stale.details.message)
    expect(await fixture.repo.head()).toBe(head)
    expect(await git(fixture.repo, ["status", "--porcelain"])).toBe("")
    expect(await readFile(path, "utf8")).toBe(newer)
    expect(existsSync(destination)).toBe(false)

    await readAsA("fresh")
    const fresh = await execute("A", "fresh mutation", mutation)
    expect(fresh.isError).toBeUndefined()
    expect(await fixture.repo.head()).not.toBe(head)
    expect(await git(fixture.repo, ["status", "--porcelain"])).toBe("")
    expect(existsSync(path)).toBe(finalPath === file_path)
    if (finalPath !== null) {
      const description = finalPath === new_path ? "Session B" : "Session A"
      expect(await readFile(join(fixture.repo.dir, finalPath), "utf8")).toBe(
        renderMemoryFile({ description }, "newer body"),
      )
    }
  })
}
