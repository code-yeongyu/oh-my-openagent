import { realpathSync } from "node:fs"
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { GitMemoryRepo, createNodeGitExec } from "../git"
import { createReflectionWorktree } from "./worktree"
import { removeTree } from "../../../../test-support/remove-tree"

const roots: string[] = []
const exec = createNodeGitExec()

export const note = (description: string, body: string): string => `---\ndescription: ${description}\n---\n\n${body}`
export const INVALID = "x".repeat(1100)
export const PEM = "-----BEGIN RSA PRIVATE KEY-----\nMIIEvgIBADANBgkqhkiG9w0BAQEFAASCBKgwggSk\n-----END RSA PRIVATE KEY-----\n"

export const LINK_TEST_TIMEOUT_MS = process.platform === "win32" ? 30_000 : 20_000

export async function cleanupLinkFixtures(): Promise<void> {
  await Promise.all(roots.splice(0).map((root) => removeTree(root, { maxRetries: 10, retryDelay: 200 })))
}

export async function linkFixture(seedFiles: Record<string, string>) {
  const root = realpathSync.native(await mkdtemp(join(tmpdir(), "reflection-links-")))
  roots.push(root)
  const repo = new GitMemoryRepo({ dir: join(root, "memory"), agentId: "agent-one" })
  await repo.init({ seedFiles: Object.entries(seedFiles).map(([relativePath, content]) => ({ relativePath, content })) })
  return createReflectionWorktree(repo, "run-1", join(root, "worktrees"))
}

export async function git(dir: string, ...argv: string[]): Promise<string> {
  const result = await exec.run(argv, { cwd: dir, timeoutMs: 30_000 })
  if (result.code !== 0) throw new Error(result.stderr)
  return result.stdout.trim()
}

export async function commitAll(dir: string, message: string): Promise<void> {
  await git(dir, "add", "-A")
  await git(dir, "-c", "user.email=fixture@example.com", "-c", "user.name=fixture", "commit", "-qm", message)
}

export async function put(dir: string, path: string, content: string): Promise<void> {
  await mkdir(dirname(join(dir, path)), { recursive: true })
  await writeFile(join(dir, path), content)
}

export const read = (dir: string, path: string): Promise<string> => readFile(join(dir, path), "utf8")
