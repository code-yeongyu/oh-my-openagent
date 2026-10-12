import { afterEach, describe, expect, test } from "bun:test"
import { mkdirSync, symlinkSync, writeFileSync } from "node:fs"
import { join } from "node:path"

import { FakeExtensionAPI } from "../../../test-support/fake-extension-api"
import { registerMemoryGuard } from "./guard"
import { componentContext } from "./memory.test-support"
import { type FilesystemOperation, registerMemoryFilesystemPolicy } from "./policy-guard"
import { canonical, policyFixture, registeredPolicy } from "./policy-guard.test-support"
import { grantProjectMemoryRead, isGrantedProjectMemoryRead, revokeProjectMemoryReads } from "./project-memory-grants"
import { rmSyncEfaultTolerant } from "./teardown.test-support"

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSyncEfaultTolerant(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
})

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
    grantProjectMemoryRead(setup.own, foreignRepo)

    // when / then
    expect(await decide("read", setup.foreignFile)).toEqual({ allow: true })
  })

  test("#given a granted project identity #when its notes are written, enumerated, or its git metadata read #then each stays denied", async () => {
    // given
    const { setup, foreignRepo, gitConfig, decide } = projectGrantFixture()
    grantProjectMemoryRead(setup.own, foreignRepo)

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
    grantProjectMemoryRead(first.setup.own, first.foreignRepo)
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
    grantProjectMemoryRead(setup.own, foreignRepo)
    const pi = new FakeExtensionAPI()
    registerMemoryGuard(pi, componentContext(), { getContext: () => setup.own, resolveCwd: () => setup.workspace })
    const call = (toolName: string, input: Record<string, unknown>) =>
      pi.dispatch("tool_call", { type: "tool_call", toolCallId: "call-1", toolName, input }, {})

    // when
    const read = await call("read", { path: setup.foreignFile })
    const write = await call("write", { path: setup.foreignFile, content: "x" })

    // then
    expect(read.some((result) => result !== undefined)).toBe(false)
    expect(write).toContainEqual(expect.objectContaining({ block: true }))
  })

  test("#given a granted project repo #when a read names its git metadata in another case or its system tree #then the grant does not cover it", () => {
    // given
    const { setup, foreignRepo } = projectGrantFixture()
    mkdirSync(join(foreignRepo, "system"), { recursive: true })
    writeFileSync(join(foreignRepo, "system", "persona.md"), "persona")
    grantProjectMemoryRead(setup.own, foreignRepo)

    // when / then
    expect(isGrantedProjectMemoryRead(setup.own, join(foreignRepo, ".GIT", "config"))).toBe(false)
    expect(isGrantedProjectMemoryRead(setup.own, join(foreignRepo, "system", "persona.md"))).toBe(false)
    expect(isGrantedProjectMemoryRead(setup.own, foreignRepo)).toBe(false)
  })

  test("#given a symlink committed inside a granted repo #when it points at another identity's memory #then a read through it is not granted", () => {
    // given
    const { setup, foreignRepo } = projectGrantFixture()
    const elsewhere = join(setup.memoryRoot, "agents", "third", "repo")
    mkdirSync(elsewhere, { recursive: true })
    writeFileSync(join(elsewhere, "secret.md"), "secret")
    symlinkSync(elsewhere, join(foreignRepo, "escape"))
    grantProjectMemoryRead(setup.own, foreignRepo)

    // when / then
    expect(isGrantedProjectMemoryRead(setup.own, join(foreignRepo, "escape", "secret.md"))).toBe(false)
  })

  test("#given a granted project repo #when the grants are revoked #then its notes are denied again", async () => {
    // given
    const { setup, foreignRepo, decide } = projectGrantFixture()
    grantProjectMemoryRead(setup.own, foreignRepo)

    // when
    revokeProjectMemoryReads(setup.own)

    // then
    expect((await decide("read", setup.foreignFile)).allow).toBe(false)
  })
})
