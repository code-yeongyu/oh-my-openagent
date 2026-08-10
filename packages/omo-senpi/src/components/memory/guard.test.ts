import { afterEach, describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, relative } from "node:path"

import { buildIdentityPaths } from "@oh-my-opencode/memory-core"

import { FakeExtensionAPI } from "../../../test-support/fake-extension-api"
import { createMemoryIdentityContext, type MemoryIdentityContext } from "./context"
import { registerMemoryGuard } from "./guard"
import { componentContext } from "./memory.test-support"

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

type GuardFixture = {
  readonly pi: FakeExtensionAPI
  readonly context: ReturnType<typeof componentContext>
  readonly own: MemoryIdentityContext
  readonly ownFile: string
  readonly foreignFile: string
  readonly agentsRoot: string
  readonly workspace: string
}

function fixture(options: { readonly bound?: boolean } = {}): GuardFixture {
  const memoryRoot = mkdtempSync(join(tmpdir(), "omo-memory-guard-"))
  const workspace = mkdtempSync(join(tmpdir(), "omo-memory-guard-workspace-"))
  roots.push(memoryRoot, workspace)

  const ownPaths = buildIdentityPaths(memoryRoot, "own")
  const foreignPaths = buildIdentityPaths(memoryRoot, "foreign")
  const ownFile = join(ownPaths.repo, "system", "persona.md")
  const foreignFile = join(foreignPaths.repo, "system", "persona.md")
  mkdirSync(dirname(ownFile), { recursive: true })
  mkdirSync(dirname(foreignFile), { recursive: true })
  mkdirSync(ownPaths.worktrees, { recursive: true })
  writeFileSync(ownFile, "own")
  writeFileSync(foreignFile, "foreign")

  const own = createMemoryIdentityContext({
    identity: "own",
    identityPaths: ownPaths,
    binding: { identity: "own", repoPathHash: "hash", boundAt: 1 },
  })
  const pi = new FakeExtensionAPI()
  const context = componentContext()
  registerMemoryGuard(pi, context, {
    getContext: () => options.bound === false ? undefined : own,
    resolveCwd: () => workspace,
  })

  return { pi, context, own, ownFile, foreignFile, agentsRoot: dirname(ownPaths.root), workspace }
}

function toolCall(toolName: string, input: Record<string, unknown>): Record<string, unknown> {
  return { type: "tool_call", toolCallId: "call-1", toolName, input }
}

async function dispatch(
  setup: GuardFixture,
  toolName: string,
  input: Record<string, unknown>,
  sessionId = "session-1",
): Promise<unknown> {
  const results = await setup.pi.dispatch("tool_call", toolCall(toolName, input), {
    sessionManager: { getSessionId: () => sessionId },
  })
  return results[0]
}

describe("memory cross-identity guard", () => {
  test("#given a bound identity #when read targets a foreign identity file #then the call is blocked with the stable reason", async () => {
    const setup = fixture()

    const result = await dispatch(setup, "read", { path: setup.foreignFile })

    expect(result).toEqual({
      block: true,
      reason: `cross-identity memory access denied: read to ${setup.foreignFile} belongs to another memory identity`,
    })
  })

  test("#given a bound identity #when write targets its own repo or worktree #then both calls are allowed", async () => {
    const setup = fixture()
    const worktreeFile = join(setup.own.identityPaths.worktrees, "reflection", "notes.md")

    expect(await dispatch(setup, "write", { filePath: setup.ownFile })).toBeUndefined()
    expect(await dispatch(setup, "edit", { file_path: worktreeFile })).toBeUndefined()
  })

  test("#given no bound identity #when a file tool targets another identity #then the guard never blocks", async () => {
    const setup = fixture({ bound: false })

    expect(await dispatch(setup, "read", { path: setup.foreignFile })).toBeUndefined()
  })

  test("#given a bound identity #when unknown tools or file tools without path arguments run #then they are allowed", async () => {
    const setup = fixture()

    expect(await dispatch(setup, "database_query", { path: setup.foreignFile })).toBeUndefined()
    expect(await dispatch(setup, "read", { offset: 1 })).toBeUndefined()
  })

  test("#given a relative traversal from the workspace #when a suffixed case-variant file tool resolves into foreign memory #then it is blocked", async () => {
    const setup = fixture()
    const relativeForeign = relative(setup.workspace, setup.foreignFile)

    const result = await dispatch(setup, "vendor_READ", { target: relativeForeign })

    expect(result).toEqual({
      block: true,
      reason: `cross-identity memory access denied: vendor_READ to ${relativeForeign} belongs to another memory identity`,
    })
  })

  test("#given paths contains own and foreign targets #when glob runs #then the foreign array member is blocked", async () => {
    const setup = fixture()

    const result = await dispatch(setup, "glob", { paths: [setup.ownFile, setup.foreignFile] })

    expect(result).toEqual({
      block: true,
      reason: `cross-identity memory access denied: glob to ${setup.foreignFile} belongs to another memory identity`,
    })
  })

  test("#given an outside symlink points into foreign memory #when a file and a not-yet-created descendant are targeted #then realpath and nearest-real-parent both block", async () => {
    const setup = fixture()
    const link = join(setup.workspace, "foreign-link")
    symlinkSync(dirname(setup.foreignFile), link)

    const existing = join(link, "persona.md")
    const missing = join(link, "new", "memory.md")

    expect(await dispatch(setup, "read", { path: existing })).toEqual({
      block: true,
      reason: `cross-identity memory access denied: read to ${existing} belongs to another memory identity`,
    })
    expect(await dispatch(setup, "write", { path: missing })).toEqual({
      block: true,
      reason: `cross-identity memory access denied: write to ${missing} belongs to another memory identity`,
    })
  })

  test("#given the identities root and one of its ancestors #when enumeration tools target them #then cross-identity enumeration is blocked", async () => {
    const setup = fixture()
    const memoryRoot = dirname(setup.agentsRoot)

    expect(await dispatch(setup, "ls", { path: setup.agentsRoot })).toEqual({
      block: true,
      reason: `cross-identity memory access denied: ls to ${setup.agentsRoot} belongs to another memory identity`,
    })
    expect(await dispatch(setup, "grep", { path: memoryRoot })).toEqual({
      block: true,
      reason: `cross-identity memory access denied: grep to ${memoryRoot} belongs to another memory identity`,
    })
    expect(await dispatch(setup, "read", { path: memoryRoot })).toBeUndefined()
  })

  test("#given a namespaced apply-patch variant #when its patch directives touch foreign memory #then every directive path is guarded", async () => {
    const setup = fixture()
    const patch = `*** Begin Patch\n*** Update File: ${setup.foreignFile}\n@@\n-foreign\n+changed\n*** End Patch`

    const result = await dispatch(setup, "vendor_APPLY_PATCH", { input: patch })

    expect(result).toEqual({
      block: true,
      reason: `cross-identity memory access denied: vendor_APPLY_PATCH to ${setup.foreignFile} belongs to another memory identity`,
    })
  })

  test("#given bash contains a forbidden foreign-root literal #when invoked repeatedly in one session #then it warns once and never blocks", async () => {
    const setup = fixture()
    const foreignRoot = dirname(dirname(dirname(setup.foreignFile)))
    const command = `find ${foreignRoot} -type f`

    expect(await dispatch(setup, "bash", { command })).toBeUndefined()
    expect(await dispatch(setup, "bash", { command })).toBeUndefined()
    expect(setup.context.logs).toEqual([{
      level: "warn",
      message: "omo-senpi memory guard advisory: bash command references another memory identity; shell text is not blocked because this soft guard is not a security boundary",
      details: { sessionId: "session-1" },
    }])
  })

  test("#given separate sessions invoke bash with a forbidden root #when advisory state is tracked #then each session receives one warning", async () => {
    const setup = fixture()
    const command = `ls ${setup.agentsRoot}`

    expect(await dispatch(setup, "bash", { command }, "session-a")).toBeUndefined()
    expect(await dispatch(setup, "bash", { command }, "session-b")).toBeUndefined()

    expect(setup.context.logs.map((entry) => entry.details)).toEqual([
      { sessionId: "session-a" },
      { sessionId: "session-b" },
    ])
  })
})
