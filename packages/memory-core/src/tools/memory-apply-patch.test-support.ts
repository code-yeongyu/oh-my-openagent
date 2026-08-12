import { spawn } from "node:child_process"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"

import { GitMemoryRepo } from "../git"
import { runMemoryApplyPatch, type MemoryApplyPatchParams } from "./memory-apply-patch"

export const author = { agentId: "patch-agent", authorName: "Patch Agent", authorEmail: "patch@example.test" }

export function createPatchFixtureHarness() {
  const tempDirs: string[] = []

  async function fixture(seedFiles: Record<string, string> = {}) {
    const root = await mkdtemp(join(tmpdir(), "memory-apply-patch-"))
    tempDirs.push(root)
    const dir = join(root, "memory")
    const repo = new GitMemoryRepo({ dir, agentId: author.agentId })
    await repo.init({ authorName: author.authorName })
    const paths = Object.keys(seedFiles)
    for (const [path, content] of Object.entries(seedFiles)) {
      await mkdir(dirname(join(dir, path)), { recursive: true })
      await writeFile(join(dir, path), content)
    }
    if (paths.length > 0) await repo.commitWrite(paths, "seed", author)
    return { root, dir, repo, locksDirectory: join(root, "locks") }
  }

  async function cleanup(): Promise<void> {
    await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
  }

  return { fixture, cleanup }
}

export function params(_locksDirectory: string, reason: string, input: string): MemoryApplyPatchParams {
  return { reason, input, author }
}

export async function memoryApplyPatch(repo: GitMemoryRepo, patchParams: MemoryApplyPatchParams) {
  return runMemoryApplyPatch({ repo, params: patchParams, lock: async (_domain, operation) => operation() })
}

export async function rejected(operation: Promise<unknown>): Promise<Error> {
  try {
    await operation
  } catch (error) {
    if (error instanceof Error) return error
    throw new Error(String(error))
  }
  throw new Error("expected operation to reject")
}

export async function git(dir: string, args: readonly string[]): Promise<string> {
  // node:child_process keeps packages/*/src runtime-neutral, so the same code runs under Node in
  // the codex and senpi adapters. The coupling audit scans every .ts that is not a .test.ts, and
  // this support file is one of them, so the bun-global spawn API is not available here.
  return await new Promise<string>((resolve, reject) => {
    const child = spawn("git", [...args], { cwd: dir, stdio: ["ignore", "pipe", "pipe"] })
    const stdout: Buffer[] = []
    const stderr: Buffer[] = []
    child.stdout?.on("data", (chunk: Buffer) => stdout.push(chunk))
    child.stderr?.on("data", (chunk: Buffer) => stderr.push(chunk))
    child.once("error", reject)
    child.once("close", (code) => {
      if (code === 0) resolve(Buffer.concat(stdout).toString("utf8").trimEnd())
      else reject(new Error(Buffer.concat(stderr).toString("utf8").trim()))
    })
  })
}
