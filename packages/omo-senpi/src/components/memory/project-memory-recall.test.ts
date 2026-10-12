import { afterEach, describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, writeFileSync, realpathSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"

import {
  GitMemoryRepo,
  MEMORY_ROOT_ENV_VAR,
  PROJECT_MEMORY_PATH_PREFIX,
  buildIdentityPaths,
  renderNudgeBlock,
  resolveMemoryIdentity,
} from "@oh-my-opencode/memory-core"

import { FakeExtensionAPI } from "../../../test-support/fake-extension-api"
import { createMemoryIdentityContext } from "./context"
import { createWakeToolBudget } from "./kibitzer/tools/budget"
import { DEFAULT_KIBITZER_TOOL_CAPS } from "./kibitzer/tools/caps"
import { createKibitzerMemoryTool } from "./kibitzer/tools/memory"
import { memorySettings } from "./memory.test-support"
import { createProjectMemoryScope } from "./project-memory-nudge"
import { createMemoryRecallWiring } from "./recall-wiring"
import { eventContext, userEntry } from "./recall-wiring.test-support"
import { rmSyncEfaultTolerant } from "./teardown.test-support"

const roots: string[] = []
const SESSION = "session-project-recall"

afterEach(() => {
  for (const root of roots.splice(0)) rmSyncEfaultTolerant(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
})

function git(cwd: string, ...args: string[]): void {
  const result = Bun.spawnSync(["git", ...args], { cwd, env: { ...process.env, GIT_TERMINAL_PROMPT: "0" } })
  if (result.exitCode !== 0) throw new Error(`git ${args.join(" ")}: ${result.stderr.toString()}`)
}

function commitNotes(repo: string, notes: Record<string, { description: string; body: string }>): void {
  mkdirSync(repo, { recursive: true })
  git(repo, "init", "-q")
  for (const [path, note] of Object.entries(notes)) {
    mkdirSync(dirname(join(repo, path)), { recursive: true })
    writeFileSync(join(repo, path), `---\ndescription: ${note.description}\n---\n${note.body}\n`)
  }
  git(repo, "add", "-A")
  git(repo, "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "-m", "seed")
}

function world(options: { recall?: boolean } = {}) {
  const root = realpathSync.native(mkdtempSync(join(tmpdir(), "project-memory-recall-")))
  roots.push(root)
  const workspace = join(root, "workspace")
  const child = join(workspace, "billing")
  const sibling = join(root, "sibling")
  for (const dir of [child, sibling]) mkdirSync(dir, { recursive: true })
  const env = { [MEMORY_ROOT_ENV_VAR]: join(root, "memory") }
  const ownIdentity = resolveMemoryIdentity("auto", workspace, env)
  commitNotes(ownIdentity.paths.repo, { "notes/own.md": { description: "workspace conventions", body: "Use bun for scripts." } })
  const childIdentity = resolveMemoryIdentity("auto", child, env)
  commitNotes(childIdentity.paths.repo, {
    "reference/invoices.md": { description: "How billing invoices are reconciled", body: "Reconcile invoices nightly against the ledger." },
  })
  commitNotes(resolveMemoryIdentity("auto", sibling, env).paths.repo, {
    "reference/invoices.md": { description: "Sibling invoices note", body: "Reconcile invoices weekly." },
  })
  const own = createMemoryIdentityContext({
    identity: ownIdentity.id,
    identityPaths: buildIdentityPaths(join(root, "memory"), ownIdentity.id),
    binding: { identity: ownIdentity.id, repoPathHash: "hash", boundAt: 1 },
  })
  const scope = createProjectMemoryScope({
    resolveContext: () => own,
    switches: () => ({ nudge: true, recall: options.recall ?? true }),
    fallbackCwd: () => workspace,
    env,
  })
  const pi = new FakeExtensionAPI()
  scope.register(pi)
  const recall = createMemoryRecallWiring({
    resolveContext: (sessionId) => (sessionId === SESSION ? own : undefined),
    resolveSettings: () => memorySettings(),
    env: {},
    projectCorpora: scope.recallCorpora,
  })
  const touch = (path: string) =>
    pi.dispatch("tool_result", { type: "tool_result", toolName: "read", input: { path }, content: [] }, {
      cwd: workspace,
      sessionManager: { getSessionId: () => SESSION },
    })
  const childPath = `${PROJECT_MEMORY_PATH_PREFIX}${childIdentity.id}/reference/invoices.md`
  return { scope, recall, touch, own, child, sibling, childIdentity, childPath }
}

const ASK = eventContext([userEntry("u1", "how do we reconcile invoices")], SESSION)

describe("project memory in Kibitzer recall (#10044)", () => {
  test("#given a child project's note matches the request #when the child has not been touched #then it is not a candidate", async () => {
    // given
    const w = world()

    // when
    const collected = await w.recall.collectCandidates(ASK)

    // then
    expect(collected?.candidates.map((candidate) => candidate.path) ?? []).not.toContain(w.childPath)
  }, 30_000)

  test("#given the session touched a file in the child project #when candidates are collected #then the child's matching note is a candidate under its project path", async () => {
    // given
    const w = world()
    await w.touch(join(w.child, "src", "invoice.ts"))

    // when
    const collected = await w.recall.collectCandidates(ASK)

    // then
    expect(collected?.candidates.map((candidate) => candidate.path)).toContain(w.childPath)
  }, 30_000)

  test("#given a project outside the session's working tree was touched #when candidates are collected #then its note never appears", async () => {
    // given
    const w = world()
    await w.touch(join(w.sibling, "invoice.ts"))

    // when
    const collected = await w.recall.collectCandidates(ASK)

    // then
    expect((collected?.candidates ?? []).some((candidate) => candidate.path.startsWith(PROJECT_MEMORY_PATH_PREFIX))).toBe(false)
  }, 30_000)

  test("#given the recall switch is off #when the child was touched #then its notes stay out of recall", async () => {
    // given
    const w = world({ recall: false })
    await w.touch(join(w.child, "src", "invoice.ts"))

    // when
    const collected = await w.recall.collectCandidates(ASK)

    // then
    expect(collected?.candidates.map((candidate) => candidate.path) ?? []).not.toContain(w.childPath)
  }, 30_000)

  test("#given the child was touched #when the sidecar's memory tool reads the project path #then it returns the child's committed note", async () => {
    // given
    const w = world()
    await w.touch(join(w.child, "a.ts"))
    const budget = createWakeToolBudget(8)
    const tool = createKibitzerMemoryTool({
      repo: new GitMemoryRepo({ dir: w.own.identityPaths.repo, agentId: w.own.identity }),
      caps: DEFAULT_KIBITZER_TOOL_CAPS,
      budget: () => budget,
      searchedPaths: new Set(),
      projectCorpora: () => w.scope.recallCorpora(SESSION),
    })

    // when
    const result = await tool.execute("call", { operation: "read", path: w.childPath })

    // then
    expect(JSON.stringify(result)).toContain("Reconcile invoices nightly")
  }, 30_000)

  test("#given a nudge on a project note #when it is rendered #then the source is the note's readable file path", async () => {
    // given
    const w = world()
    await w.touch(join(w.child, "a.ts"))

    // when
    const source = w.scope.sourceFor(SESSION, w.childPath)
    const block = renderNudgeBlock({ path: w.childPath, hint: "Invoices are reconciled nightly.", ...(source === undefined ? {} : { source }) })

    // then
    expect(source).toBe(join(w.childIdentity.paths.repo, "reference", "invoices.md"))
    expect(block).toContain(`source="[[${source}]]"`)
    expect(w.scope.sourceFor(SESSION, "notes/own.md")).toBeUndefined()
  }, 30_000)
})
