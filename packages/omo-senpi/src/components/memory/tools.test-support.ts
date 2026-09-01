import { afterEach } from "bun:test"
import { execFile } from "node:child_process"
import { mkdtemp, mkdir, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { promisify } from "node:util"
import { rmEfaultTolerant } from "./teardown.test-support"

import {
  GitMemoryRepo,
  buildIdentityPaths,
  parseMemoryFile,
  renderMemoryFile,
  type GitCommitAuthor,
} from "@oh-my-opencode/memory-core"

import { FakeExtensionAPI } from "../../../test-support/fake-extension-api"
import { createMemoryBinding } from "./binding"
import { createMemoryIdentityContext, type MemoryIdentityContext } from "./context"
import {
  type MemoryToolExecutionResult,
} from "./tools"

const exec = promisify(execFile)
export const IDENTITY = "agent-memory-tools-test"
const AUTHOR: GitCommitAuthor = { agentId: IDENTITY, authorName: "Memory Tools Test Agent" }

export const roots: string[] = []
const WINDOWS_CLEANUP_RACE_CODES = new Set(["EBUSY", "ENOTEMPTY", "EPERM"])

// Every fixture is a real Git repo, so cleanup races the git children this suite just ran. Windows
// releases their file handles asynchronously, and an unretried rm here bills its stall to the NEXT
// test file's budget - the exact shape of the tools-apply-patch timeout on CI.
async function removeRoot(root: string): Promise<void> {
  try {
    await rmEfaultTolerant(root, { recursive: true, force: true, maxRetries: 30, retryDelay: 200 })
  } catch (error) {
    // A lingering Windows handle can outlast the bounded retry window. Ignore only that platform's
    // known cleanup races; every other cleanup defect still fails loudly.
    if (
      process.platform === "win32"
      && error instanceof Error
      && "code" in error
      && typeof error.code === "string"
      && WINDOWS_CLEANUP_RACE_CODES.has(error.code)
    ) return
    throw error
  }
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map(removeRoot))
})

export interface BoundFixture {
  readonly context: MemoryIdentityContext
  readonly repo: GitMemoryRepo
  readonly locksDirectory: string
}

export async function boundFixture(): Promise<BoundFixture> {
  const root = await mkdtemp(join(tmpdir(), "omo-senpi-memory-tools-"))
  roots.push(root)
  const identityPaths = buildIdentityPaths(root, IDENTITY)
  const repo = new GitMemoryRepo({ dir: identityPaths.repo, agentId: IDENTITY })
  await repo.init({ authorName: AUTHOR.authorName })
  const binding = createMemoryBinding({ identity: IDENTITY, repoPath: identityPaths.repo, boundAt: Date.now() })
  const context = createMemoryIdentityContext({ identity: IDENTITY, identityPaths, binding })
  return { context, repo, locksDirectory: identityPaths.locks }
}

export async function seedFile(fixture: BoundFixture, path: string, body: string): Promise<void> {
  const fullPath = join(fixture.repo.dir, path)
  await mkdir(dirname(fullPath), { recursive: true })
  await writeFile(fullPath, renderMemoryFile({ description: "Seed" }, body), "utf8")
  await fixture.repo.commitWrite([path], `seed ${path}`, AUTHOR)
}

export async function git(repo: GitMemoryRepo, args: string[]): Promise<string> {
  const result = await exec("git", args, { cwd: repo.dir })
  return String(result.stdout).trim()
}

export function textOf(result: MemoryToolExecutionResult): string {
  const first = result.content[0]
  return first !== undefined && first.type === "text" ? first.text : ""
}
