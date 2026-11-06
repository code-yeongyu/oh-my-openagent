import { afterEach, describe, expect, test } from "bun:test"
import { mkdirSync, readFileSync, realpathSync, renameSync, symlinkSync, writeFileSync } from "node:fs"
import { join, relative, resolve } from "node:path"

import { FakeExtensionAPI } from "../../../test-support/fake-extension-api"
import { registerMemoryGuard } from "./guard"
import { componentContext } from "./memory.test-support"
import { type FilesystemOperation, registerMemoryFilesystemPolicy } from "./policy-guard"
import { canonical, policyFixture, registeredPolicy } from "./policy-guard.test-support"
import { grantProjectMemoryRead, isGrantedProjectMemoryRead, revokeProjectMemoryReads } from "./project-memory-grants"
import { rmSyncEfaultTolerant } from "./teardown.test-support"
import { AUTOMOUNT_TRIGGER_CASES, withAutomountTrap } from "../../automount-trap.test-support"

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSyncEfaultTolerant(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
})

// Windows creates directory junctions without privileges; POSIX gets a plain directory symlink.
function linkDir(target: string, path: string): void {
  symlinkSync(target, path, process.platform === "win32" ? "junction" : "dir")
}

function projectGrantFixture() {
  const setup = policyFixture(roots)
  const foreignRepo = join(setup.foreignRoot, "repo")
  const foreignNote = join(foreignRepo, "reference", "deploy.md")
  mkdirSync(join(foreignRepo, "reference"), { recursive: true })
  writeFileSync(foreignNote, "deploy")
  const gitConfig = join(foreignRepo, ".git", "config")
  mkdirSync(join(foreignRepo, ".git"), { recursive: true })
  mkdirSync(join(setup.foreignRoot, "runtime"), { recursive: true })
  writeFileSync(gitConfig, "[core]")
  registerMemoryFilesystemPolicy(setup.pi, setup.own)
  const policy = registeredPolicy(setup)
  const decide = (operation: FilesystemOperation, path: string) =>
    policy.check({ operation, canonicalPath: canonical(path), toolName: operation === "write" ? "write" : "read" })
  return { setup: { ...setup, foreignFile: foreignNote }, foreignRepo, gitConfig, decide }
}

describe("project memory read grants (#10044)", () => {
  test("#given a project identity the resolver returned #when its note is read #then the hard policy allows it", async () => {
    // given
    const { setup, foreignRepo, decide } = projectGrantFixture()
    await grantProjectMemoryRead(setup.own, foreignRepo)

    // when / then
    expect(await decide("read", setup.foreignFile),
      `grant comparison: child=${realpathSync.native(setup.foreignFile)}; parent=${realpathSync.native(foreignRepo)}`,
    ).toEqual({ allow: true })
  })

  test("#given a granted project identity #when its notes are written, enumerated, or its git metadata read #then each stays denied", async () => {
    // given
    const { setup, foreignRepo, gitConfig, decide } = projectGrantFixture()
    await grantProjectMemoryRead(setup.own, foreignRepo)

    // when / then
    expect((await decide("write", setup.foreignFile)).allow).toBe(false)
    expect((await decide("enumerate", foreignRepo)).allow).toBe(false)
    expect((await decide("read", gitConfig)).allow).toBe(false)
    expect((await decide("read", join(setup.foreignRoot, "runtime"))).allow).toBe(false)
  })

  test("#given no grant #when a project identity's note is read #then it stays denied", async () => {
    // given
    const { setup, decide } = projectGrantFixture()

    // when / then
    expect((await decide("read", setup.foreignFile)).allow).toBe(false)
  })

  test("#given a grant on one session's identity #when another bound identity reads the same note #then it stays denied", async () => {
    // given
    const first = projectGrantFixture()
    const second = policyFixture(roots)
    await grantProjectMemoryRead(first.setup.own, first.foreignRepo)
    registerMemoryFilesystemPolicy(second.pi, second.own)

    // when
    const decision = await registeredPolicy(second).check({
      operation: "read",
      canonicalPath: canonical(second.foreignFile),
      toolName: "read",
    })

    // then
    expect(decision.allow).toBe(false)
  })

  test("#given a granted project identity #when the soft guard sees a read and a write tool call #then only the read passes", async () => {
    // given
    const { setup, foreignRepo } = projectGrantFixture()
    await grantProjectMemoryRead(setup.own, foreignRepo)
    const pi = new FakeExtensionAPI()
    registerMemoryGuard(pi, componentContext(), { getContext: () => setup.own, resolveCwd: () => setup.workspace })
    const call = (toolName: string, input: Record<string, unknown>) =>
      pi.dispatch("tool_call", { type: "tool_call", toolCallId: "call-1", toolName, input }, {})

    // when
    const read = await call("read", { path: setup.foreignFile })
    const write = await call("write", { path: setup.foreignFile, content: "x" })

    // then
    expect(read.some((result) => result !== undefined),
      `grant comparison: child=${realpathSync.native(setup.foreignFile)}; parent=${realpathSync.native(foreignRepo)}`,
    ).toBe(false)
    expect(write).toContainEqual(expect.objectContaining({ block: true }))
  })

  test("#given a granted project repo #when a read names its git metadata in another case or its system tree #then the grant does not cover it", async () => {
    // given
    const { setup, foreignRepo } = projectGrantFixture()
    mkdirSync(join(foreignRepo, "system"), { recursive: true })
    writeFileSync(join(foreignRepo, "system", "persona.md"), "persona")
    await grantProjectMemoryRead(setup.own, foreignRepo)

    // when / then
    expect(isGrantedProjectMemoryRead(setup.own, join(foreignRepo, ".GIT", "config"))).toBe(false)
    expect(isGrantedProjectMemoryRead(setup.own, join(foreignRepo, "system", "persona.md"))).toBe(false)
    expect(isGrantedProjectMemoryRead(setup.own, foreignRepo)).toBe(false)
  })

  test("#given a symlink committed inside a granted repo #when it points at another identity's memory #then a read through it is not granted", async () => {
    // given
    const { setup, foreignRepo } = projectGrantFixture()
    const elsewhere = join(setup.memoryRoot, "agents", "third", "repo")
    mkdirSync(elsewhere, { recursive: true })
    writeFileSync(join(elsewhere, "secret.md"), "secret")
    symlinkSync(elsewhere, join(foreignRepo, "escape"))
    await grantProjectMemoryRead(setup.own, foreignRepo)

    // when / then
    expect(isGrantedProjectMemoryRead(setup.own, join(foreignRepo, "escape", "secret.md"))).toBe(false)
  })

  test("#given a granted repo later replaced by a link into a third identity #when a note is read through it #then the grant no longer covers it", async () => {
    // given
    const { setup, foreignRepo } = projectGrantFixture()
    const third = join(setup.memoryRoot, "agents", "third", "repo")
    mkdirSync(join(third, "reference"), { recursive: true })
    writeFileSync(join(third, "reference", "secret.md"), "secret")
    await grantProjectMemoryRead(setup.own, foreignRepo)

    // when
    renameSync(foreignRepo, `${foreignRepo}-moved`)
    linkDir(third, foreignRepo)

    // then
    expect(isGrantedProjectMemoryRead(setup.own, join(foreignRepo, "reference", "secret.md"))).toBe(false)
  })

  test("#given a granted repo #when a note that does not exist yet is read #then the grant still covers it so the read reports it missing", async () => {
    // given
    const { setup, foreignRepo } = projectGrantFixture()
    await grantProjectMemoryRead(setup.own, foreignRepo)

    // when / then
    expect(isGrantedProjectMemoryRead(setup.own, join(foreignRepo, "reference", "missing.md"))).toBe(true)
    expect(isGrantedProjectMemoryRead(setup.own, join(foreignRepo, "draft", "missing.md"))).toBe(true)
  })

  test("#given a granted repo reached through a linked alias #when a nested missing note is read #then the remainder lands under the native repo path", async () => {
    // given
    const { setup, foreignRepo } = projectGrantFixture()
    const alias = join(setup.workspace, "repo-alias")
    linkDir(foreignRepo, alias)
    await grantProjectMemoryRead(setup.own, foreignRepo)

    // when / then
    expect(isGrantedProjectMemoryRead(setup.own, `${alias}/new/dir/note.md`)).toBe(true)
    expect(isGrantedProjectMemoryRead(setup.own, `${alias}/new/system/note.md`)).toBe(true)
    expect(isGrantedProjectMemoryRead(setup.own, `${alias}/system/new/note.md`)).toBe(false)
  })

  test("#given a granted repo #when a missing remainder carries dot, dot-dot, or empty segments #then no read is granted", async () => {
    // given
    const { setup, foreignRepo } = projectGrantFixture()
    writeFileSync(join(foreignRepo, "note.md"), "root note")
    await grantProjectMemoryRead(setup.own, foreignRepo)

    // when / then
    expect(isGrantedProjectMemoryRead(setup.own, join(foreignRepo, "note.md"))).toBe(true)
    const remainders = ["missing/../note.md", "a/./b", "a//b", "new/dir/"]
    const granted = remainders.map((remainder) => [remainder, isGrantedProjectMemoryRead(setup.own, `${foreignRepo}/${remainder}`)])
    // Win32 collapses `missing/..` lexically before the kernel sees the path, so the raw opener reads the same
    // note.md and granting it is correct there; POSIX keeps `missing/..` a real lookup, which fails.
    const expected = (remainder: string) => process.platform === "win32" && remainder === "missing/../note.md"
    expect(Object.fromEntries(granted)).toEqual(Object.fromEntries(remainders.map((remainder) => [remainder, expected(remainder)])))
  })

  test("#given a dangling link in a granted repo #when a read names it #then it is not treated as a missing note", async () => {
    // given
    const { setup, foreignRepo } = projectGrantFixture()
    const ghost = join(foreignRepo, "reference", "ghost.md")
    symlinkSync(join(setup.memoryRoot, "agents", "third", "later.md"), ghost)
    await grantProjectMemoryRead(setup.own, foreignRepo)

    // when / then
    expect(isGrantedProjectMemoryRead(setup.own, ghost)).toBe(false)
  })

  test("#given a granted repo #when resolution fails for a non-missing reason #then no read is granted", async () => {
    const { setup, foreignRepo } = projectGrantFixture()
    await grantProjectMemoryRead(setup.own, foreignRepo)

    expect(isGrantedProjectMemoryRead(setup.own, `${setup.foreignFile}/missing.md`)).toBe(false)
    expect(isGrantedProjectMemoryRead(setup.own, setup.foreignFile, {
      realpath: (input) => {
        if (input === setup.foreignFile) throw Object.assign(new Error("permission denied"), { code: "EACCES" })
        return realpathSync.native(input)
      },
    })).toBe(false)
  })

  test("#given a granted repo #when a missing remainder sits under a FILE and resolution reports ENOENT (as Windows does) #then no read is granted", async () => {
    const { setup, foreignRepo } = projectGrantFixture()
    await grantProjectMemoryRead(setup.own, foreignRepo)
    const below = `${setup.foreignFile}/missing.md`

    expect(isGrantedProjectMemoryRead(setup.own, below, {
      realpath: (input) => {
        if (input === below) throw Object.assign(new Error("no such file"), { code: "ENOENT" })
        return realpathSync.native(input)
      },
    })).toBe(false)
  })

  test("#given dot-dot after a link out of a granted repo #when raw and built-in reads are checked #then each verdict agrees with its opener", async () => {
    // given
    const { setup, foreignRepo } = projectGrantFixture()
    const outside = join(setup.memoryRoot, "agents", "third", "subdir")
    mkdirSync(join(outside, "..", "reference"), { recursive: true })
    mkdirSync(outside, { recursive: true })
    writeFileSync(join(outside, "..", "reference", "deploy.md"), "third")
    linkDir(outside, join(foreignRepo, "jump"))
    await grantProjectMemoryRead(setup.own, foreignRepo)
    const target = `${foreignRepo}/jump/../reference/deploy.md`

    // when
    const granted = isGrantedProjectMemoryRead(setup.own, target)
    const pi = new FakeExtensionAPI()
    registerMemoryGuard(pi, componentContext(), { getContext: () => setup.own, resolveCwd: () => setup.workspace })
    const call = (toolName: string, target: string) =>
      pi.dispatch("tool_call", { type: "tool_call", toolCallId: "raw-read", toolName, input: { path: target } }, {})

    // then
    expect(readFileSync(resolve(target), "utf8")).toBe("deploy")
    expect(readFileSync(target, "utf8")).toBe(process.platform === "win32" ? "deploy" : "third")
    expect(granted).toBe(process.platform === "win32")
    expect(isGrantedProjectMemoryRead(setup.own, resolve(target))).toBe(true)
    expect((await call("read", target)).some((result) => result !== undefined)).toBe(false)
    for (const raw of [target, relative(setup.workspace, foreignRepo) + "/jump/../reference/deploy.md"]) {
      const results = await call("vendor_read", raw)
      expect(results.some((result) => result !== undefined)).toBe(process.platform !== "win32")
    }
    expect(isGrantedProjectMemoryRead(setup.own, `${foreignRepo}/jump/../reference/missing.md`)).toBe(process.platform === "win32")
    expect(isGrantedProjectMemoryRead(setup.own, `${foreignRepo}/jump/../draft/missing.md`)).toBe(process.platform === "win32")
  })

  test("#given a granted project repo #when the grants are revoked #then its notes are denied again", async () => {
    // given
    const { setup, foreignRepo, decide } = projectGrantFixture()
    await grantProjectMemoryRead(setup.own, foreignRepo)

    // when
    revokeProjectMemoryReads(setup.own)

    // then
    expect((await decide("read", setup.foreignFile)).allow).toBe(false)
  })
})

describe("project memory read grants never resolve a macOS automount trigger (#11545)", () => {
  test.each([...AUTOMOUNT_TRIGGER_CASES])("#given a granted project and a read of %s on darwin #when the grant is checked #then it is not granted and the trigger is never resolved", async (path) => {
    const { setup, foreignRepo } = projectGrantFixture()
    await grantProjectMemoryRead(setup.own, foreignRepo)
    const touched = await withAutomountTrap(() => {
      expect(isGrantedProjectMemoryRead(setup.own, path)).toBe(false)
    })
    expect(touched).toEqual([])
  })
})
