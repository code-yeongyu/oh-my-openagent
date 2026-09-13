import { describe, expect, test } from "bun:test"
import { mkdir, symlink, writeFile } from "node:fs/promises"
import { join } from "node:path"

import { GATE_ENTRY_TYPE } from "../notice"
import { normalizeMemoryPath, resolveWorkspacePath } from "./path-safety"
import { commitMemory, customEntry, harness, jsonOf, memoryRepo, message, sessionContext, tempRoot, writeMemory } from "./test-support"

describe("normalizeMemoryPath", () => {
  test("#given traversal absolute system and backslash paths #when normalized #then each is rejected with a code", () => {
    expect(normalizeMemoryPath("../outside.md")).toMatchObject({ ok: false, code: "path_traversal" })
    expect(normalizeMemoryPath("notes/../../outside.md")).toMatchObject({ ok: false, code: "path_traversal" })
    expect(normalizeMemoryPath("/etc/passwd")).toMatchObject({ ok: false, code: "path_absolute" })
    expect(normalizeMemoryPath("system/identity.md")).toMatchObject({ ok: false, code: "system_path" })
    expect(normalizeMemoryPath("notes\\deploy.md")).toMatchObject({ ok: false, code: "path_separator" })
    expect(normalizeMemoryPath("")).toMatchObject({ ok: false, code: "path_empty" })
  })

  test("#given ordinary relative paths #when normalized #then ./ prefixes collapse and nested system/ segments stay allowed", () => {
    expect(normalizeMemoryPath("./notes/deploy.md")).toEqual({ ok: true, path: "notes/deploy.md" })
    expect(normalizeMemoryPath("reference/system/deploy.md")).toEqual({ ok: true, path: "reference/system/deploy.md" })
  })
})

describe("resolveWorkspacePath", () => {
  test("#given a symlink escaping the workspace #when resolved #then it is rejected", async () => {
    const root = await tempRoot("omo-kibitzer-ws-")
    const outside = await tempRoot("omo-kibitzer-outside-")
    await writeFile(join(outside, "secret.txt"), "outside", "utf8")
    await symlink(join(outside, "secret.txt"), join(root, "escape.txt"))
    await writeFile(join(root, "inside.txt"), "inside", "utf8")

    expect(await resolveWorkspacePath(root, "escape.txt")).toMatchObject({ ok: false, code: "path_escape" })
    expect(await resolveWorkspacePath(root, "../outside")).toMatchObject({ ok: false, code: "path_escape" })
    expect(await resolveWorkspacePath(root, "/etc/hosts")).toMatchObject({ ok: false, code: "path_escape" })
    expect(await resolveWorkspacePath(root, "inside.txt")).toMatchObject({ ok: true })
  })
})

describe("sidecar tool path safety", () => {
  test("rejects traversal uncommitted and hidden entries", async () => {
    const root = await tempRoot("omo-kibitzer-ws-")
    await mkdir(join(root, "src"), { recursive: true })
    await writeFile(join(root, "src", "ok.ts"), "ok", "utf8")
    const repo = await memoryRepo()
    await commitMemory(repo, "notes/committed.md", "committed body")
    await writeMemory(repo, "notes/uncommitted.md", "uncommitted body")
    const h = harness({ workspaceRoot: root, repo })
    h.snapshot.refresh(sessionContext([
      message("user", "visible", "e0"),
      customEntry(GATE_ENTRY_TYPE, "e1", { version: 1, status: "failed", candidateCount: 0 }),
    ]))

    const traversal = await h.call("read", { path: "../outside" })
    expect(traversal.isError).toBe(true)
    expect(jsonOf(traversal)).toMatchObject({ rejected: "path_escape" })

    const uncommitted = await h.call("memory", { operation: "read", path: "notes/uncommitted.md" })
    expect(uncommitted.isError).toBe(true)
    expect(jsonOf(uncommitted)).toMatchObject({ rejected: "not_committed", path: "notes/uncommitted.md" })

    const page = jsonOf(await h.call("session_entries", { since: -1 }))
    expect(page.entries).toHaveLength(1)
    expect(page.hidden).toBe(1)
  })

  test("#given memory traversal system and symlink paths #when read #then each is rejected structurally", async () => {
    const root = await tempRoot("omo-kibitzer-ws-")
    const outside = await tempRoot("omo-kibitzer-outside-")
    await writeFile(join(outside, "leak.md"), "---\ndescription: leak\n---\nleaked", "utf8")
    const repo = await memoryRepo()
    await commitMemory(repo, "system/identity.md", "who I am")
    await mkdir(join(repo.dir, "notes"), { recursive: true })
    await symlink(join(outside, "leak.md"), join(repo.dir, "notes", "link.md"))
    await repo.commitWrite(["notes/link.md"], "commit symlink", { agentId: "t", authorName: "t" })
    const h = harness({ workspaceRoot: root, repo })

    expect(jsonOf(await h.call("memory", { operation: "read", path: "../outside.md" }))).toMatchObject({ rejected: "path_traversal" })
    expect(jsonOf(await h.call("memory", { operation: "read", path: "system/identity.md" }))).toMatchObject({ rejected: "system_path" })
    const link = await h.call("memory", { operation: "read", path: "notes/link.md" })
    expect(link.isError).toBe(true)
    expect(jsonOf(link)).toMatchObject({ rejected: "not_committed" })
    expect(JSON.stringify(link.content)).not.toContain("leaked")
  })

  test("#given grep on an escaping path #when called #then it is rejected and symlinked files are not followed", async () => {
    const root = await tempRoot("omo-kibitzer-ws-")
    const outside = await tempRoot("omo-kibitzer-outside-")
    await writeFile(join(outside, "secret.txt"), "needle outside", "utf8")
    await symlink(join(outside, "secret.txt"), join(root, "escape.txt"))
    await writeFile(join(root, "inside.txt"), "needle inside", "utf8")
    const repo = await memoryRepo()
    const h = harness({ workspaceRoot: root, repo })

    expect(jsonOf(await h.call("grep", { pattern: "needle", path: "../" }))).toMatchObject({ rejected: "path_escape" })
    const matches = jsonOf(await h.call("grep", { pattern: "needle" })).matches as { path: string }[]
    expect(matches.map((match) => match.path)).toEqual(["inside.txt"])
  })
})
