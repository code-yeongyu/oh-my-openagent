import { onTestFinished } from "bun:test"
import { mkdtemp, mkdir, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"

import { GitMemoryRepo, renderMemoryFile, type GitCommitAuthor, type RecallNudge } from "@oh-my-opencode/memory-core"

import { rmEfaultTolerant } from "../../teardown.test-support"
import { createWakeToolBudget, type WakeToolBudget } from "./budget"
import { createKibitzerSidecarTools, type AnyKibitzerSidecarTool, type KibitzerSidecarToolsInput } from "./index"
import type { KibitzerToolResult } from "./result"
import { createSessionBranchSnapshot } from "./session-read"

export const IDENTITY = "agent-kibitzer-tools-test"
export const AUTHOR: GitCommitAuthor = { agentId: IDENTITY, authorName: "Kibitzer Tools Test Agent" }

export async function tempRoot(prefix = "omo-kibitzer-tools-"): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), prefix))
  onTestFinished(() => rmEfaultTolerant(root, { recursive: true, force: true, maxRetries: 30, retryDelay: 200 }))
  return root
}

export async function memoryRepo(): Promise<GitMemoryRepo> {
  const root = await tempRoot("omo-kibitzer-memory-")
  const repo = new GitMemoryRepo({ dir: join(root, "repo"), agentId: IDENTITY })
  await repo.init({ authorName: AUTHOR.authorName })
  return repo
}

export async function writeMemory(repo: GitMemoryRepo, path: string, body: string, description = "Seed"): Promise<void> {
  const fullPath = join(repo.dir, path)
  await mkdir(dirname(fullPath), { recursive: true })
  await writeFile(fullPath, renderMemoryFile({ description }, body), "utf8")
}

export async function commitMemory(repo: GitMemoryRepo, path: string, body: string, description = "Seed"): Promise<void> {
  await writeMemory(repo, path, body, description)
  await repo.commitWrite([path], `seed ${path}`, AUTHOR)
}

/** Commits through raw git with no hook, the way content written before secret screening existed sits in a repo. */
export async function commitLegacyMemory(repo: GitMemoryRepo, path: string, body: string): Promise<void> {
  await writeMemory(repo, path, body)
  for (const argv of [["add", "--", path], ["commit", "--no-verify", "-m", `legacy ${path}`]]) {
    const result = Bun.spawnSync(["git", ...argv], { cwd: repo.dir })
    if (result.exitCode !== 0) throw new Error(`git ${argv[0]} failed: ${result.stderr.toString()}`)
  }
}

export interface Harness {
  readonly tools: readonly AnyKibitzerSidecarTool[]
  readonly searchedPaths: ReadonlySet<string>
  readonly budget: WakeToolBudget
  readonly accepted: RecallNudge[]
  readonly offered: Set<string>
  readonly surfaced: Set<string>
  readonly snapshot: ReturnType<typeof createSessionBranchSnapshot>
  call(name: string, params: Record<string, unknown>): Promise<KibitzerToolResult>
}

export interface HarnessOptions {
  readonly workspaceRoot: string
  readonly repo: GitMemoryRepo
  readonly budgetLimit?: number
  readonly maxItems?: number
  readonly caps?: KibitzerSidecarToolsInput["caps"]
  readonly queryExpansion?: boolean
}

export function harness(options: HarnessOptions): Harness {
  const budget = createWakeToolBudget(options.budgetLimit ?? 8)
  const accepted: RecallNudge[] = []
  const offered = new Set<string>()
  const surfaced = new Set<string>()
  const snapshot = createSessionBranchSnapshot()
  const created = createKibitzerSidecarTools({
    workspaceRoot: options.workspaceRoot,
    session: snapshot,
    memory: { repo: options.repo, ...(options.queryExpansion === undefined ? {} : { queryExpansion: options.queryExpansion }) },
    nudge: { offered, surfaced, maxItems: options.maxItems ?? 2, accepted: () => accepted },
    budget: () => budget,
    ...(options.caps === undefined ? {} : { caps: options.caps }),
  })
  return {
    tools: created.tools,
    searchedPaths: created.searchedPaths,
    budget,
    accepted,
    offered,
    surfaced,
    snapshot,
    async call(name, params) {
      const tool = created.tools.find((candidate) => candidate.name === name)
      if (tool === undefined) throw new Error(`no tool named ${name}`)
      return tool.execute(`call-${name}`, params as never)
    },
  }
}

export function textOf(result: KibitzerToolResult): string {
  const first = result.content[0]
  return first !== undefined && first.type === "text" ? first.text : ""
}

export function jsonOf(result: KibitzerToolResult): Record<string, unknown> {
  return JSON.parse(textOf(result)) as Record<string, unknown>
}

export function message(role: "user" | "assistant", text: string, id: string, customType?: string): Record<string, unknown> {
  return {
    type: "message",
    id,
    parentId: null,
    timestamp: "2026-09-11T00:00:00.000Z",
    message: { role, content: [{ type: "text", text }], ...(customType === undefined ? {} : { customType }) },
  }
}

export function customEntry(customType: string, id: string, data: unknown = {}): Record<string, unknown> {
  return { type: "custom", id, parentId: null, timestamp: "2026-09-11T00:00:00.000Z", customType, data }
}

export function customMessage(customType: string, id: string, text: string): Record<string, unknown> {
  return { type: "custom_message", id, parentId: null, timestamp: "2026-09-11T00:00:00.000Z", customType, content: text, display: false }
}

export function sessionContext(entries: readonly unknown[]): Record<string, unknown> {
  return { sessionManager: { getSessionId: () => "parent-session", getBranch: () => entries } }
}
