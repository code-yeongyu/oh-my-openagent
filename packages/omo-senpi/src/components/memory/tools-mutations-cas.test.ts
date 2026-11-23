import { expect, test } from "bun:test"
import { existsSync } from "node:fs"
import { readFile, symlink, unlink, writeFile } from "node:fs/promises"
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

const recursiveCases = [
  ["direct delete of a replacement directory", file_path, `${file_path}/new.md`],
  ["ancestor delete with a replacement directory", "reference/history", `${file_path}/new.md`],
  ["ancestor delete with a missing observation", "reference/history", "reference/history/other/new.md"],
] as const

for (const [name, target, replacement] of recursiveCases) {
  test(`${name} refuses the stale session but allows a freshly read tree`, async () => {
    const fixture = await boundFixture()
    await seedFile(fixture, file_path, "original body")
    const sessionB = createMemoryIdentityContext(fixture.context)
    const resolve = (id?: string) => (id === "A" ? fixture.context : sessionB)
    const context = (id: string) => ({ sessionManager: { getSessionId: () => id } })
    const pi = new FakeExtensionAPI()
    registerMemoryGuard(pi, componentContext(), { getContext: (ctx) => resolve(sessionIdFrom(ctx)) })
    const [tool] = createMemoryTools(resolve)
    const readAs = async (id: string, label: string) => {
      const path = join(fixture.repo.dir, label)
      const call = { toolCallId: `read ${label}`, toolName: "read", input: { path } }
      await pi.dispatch("tool_call", call, context(id))
      const content = [{ type: "text", text: await readFile(path, "utf8") }]
      await pi.dispatch("tool_result", { ...call, isError: false, content }, context(id))
    }
    const execute = (id: string, reason: string, params: Omit<Parameters<typeof tool.execute>[1], "reason">) =>
      tool.execute(reason, { ...params, reason }, undefined, undefined, context(id))

    await readAs("A", file_path)
    const removed = await execute("B", "remove original note", { command: "delete", file_path })
    expect(removed.isError).toBeUndefined()
    const sibling = "reference/history/sibling.md"
    const newerNotes = [
      [replacement, "new child"],
      [sibling, "new sibling"],
    ] as const
    for (const [label, body] of newerNotes) {
      const created = await execute("B", `create ${label}`, {
        command: "create",
        file_path: label,
        description: "Session B",
        file_text: body,
      })
      expect(created.isError).toBeUndefined()
    }
    const head = await fixture.repo.head()
    const mutation = { command: "delete", file_path: target } as const

    const stale = await execute("A", "stale delete", mutation)
    expect(stale.details.errorCode).toBe("stale_read")
    expect(stale.isError).toBe(true)
    expect(stale.details.message).toContain(join(fixture.repo.dir, file_path))
    expect(await fixture.repo.head()).toBe(head)
    expect(await git(fixture.repo, ["status", "--porcelain"])).toBe("")
    for (const [label, body] of newerNotes) {
      expect(await readFile(join(fixture.repo.dir, label), "utf8")).toBe(
        renderMemoryFile({ description: "Session B" }, body),
      )
      await readAs("B", label)
    }

    // B reads the current files without A's observation of the former file at this path.
    const fresh = await execute("B", "fresh delete", mutation)
    expect(fresh.isError).toBeUndefined()
    expect(await fixture.repo.head()).not.toBe(head)
    expect(await git(fixture.repo, ["status", "--porcelain"])).toBe("")
    expect(existsSync(join(fixture.repo.dir, target))).toBe(false)
    expect(existsSync(join(fixture.repo.dir, sibling))).toBe(target === file_path)
  })
}

const symlinkCases = [
  ["unchanged", null],
  ["retargeted to a file with identical bytes", "retarget"],
  ["target content changed", "edit"],
  ["alias removed", "unlink"],
  ["canonical target removed", "remove-target"],
] as const

for (const [name, change] of symlinkCases) {
  test(`recursive delete after reading a symlink: ${name}`, async () => {
    const fixture = await boundFixture()
    const tree = "reference/history"
    const alias = `${tree}/alias.md`
    const alternate = "reference/alternate.md"
    const original = renderMemoryFile({ description: "Seed" }, "original body")
    await seedFile(fixture, file_path, "original body")
    await seedFile(fixture, alternate, "original body")
    const path = join(fixture.repo.dir, alias)
    await symlink("nested/notes.md", path, "file")
    const commit = (changed: string, reason: string) =>
      fixture.repo.commitWrite([changed], reason, { agentId: "writer-b", authorName: "Writer B" })
    await commit(alias, "seed alias")

    const pi = new FakeExtensionAPI()
    const context = { sessionManager: { getSessionId: () => "A" } }
    const resolve = () => fixture.context
    registerMemoryGuard(pi, componentContext(), { getContext: resolve })
    const [tool] = createMemoryTools(resolve)
    const call = { toolCallId: "read alias", toolName: "read", input: { path } }
    await pi.dispatch("tool_call", call, context)
    const content = [{ type: "text", text: await readFile(path, "utf8") }]
    await pi.dispatch("tool_result", { ...call, isError: false, content }, context)

    switch (change) {
      case "retarget":
        await unlink(path)
        await symlink("../alternate.md", path, "file")
        await commit(alias, "retarget alias")
        break
      case "edit":
        await writeFile(join(fixture.repo.dir, file_path), renderMemoryFile({ description: "Seed" }, "newer body"))
        await commit(file_path, "edit canonical note")
        break
      case "unlink":
        await unlink(path)
        await commit(alias, "remove alias")
        break
      case "remove-target":
        await unlink(join(fixture.repo.dir, file_path))
        await commit(file_path, "remove canonical note")
        break
      case null:
        break
    }
    const head = await fixture.repo.head()
    const deleted = await tool.execute(
      "delete tree",
      { command: "delete", file_path: tree, reason: "delete tree" },
      undefined,
      undefined,
      context,
    )

    if (change === null) {
      expect(deleted.details).toMatchObject({ message: expect.stringContaining("Memory delete committed") })
      expect(await fixture.repo.head()).not.toBe(head)
      expect(existsSync(join(fixture.repo.dir, tree))).toBe(false)
    } else {
      expect(deleted.details.errorCode).toBe("stale_read")
      expect(deleted.isError).toBe(true)
      expect(await fixture.repo.head()).toBe(head)
      expect(existsSync(join(fixture.repo.dir, tree))).toBe(true)
    }
    expect(await git(fixture.repo, ["status", "--porcelain"])).toBe("")
    expect(await readFile(join(fixture.repo.dir, alternate), "utf8")).toBe(original)
  })
}
