import { afterEach } from "bun:test"
import { mkdtemp, mkdir, rm } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import type { IsolationBackend } from "./backend"

const roots: string[] = []
afterEach(async () => {
  // win32 tears a killed tree down asynchronously: a survivor keeps its
  // working directory locked and the removal only lands once the tree is gone
  // (the EBUSY family #8610 absorbed with rmSync retries). The documented rm
  // retries absorb that latency instead of failing the next test's cleanup.
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 500 })))
})
export async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "isolation-core-"))
  roots.push(root)
  const homeDir = join(root, "home")
  const repoRoot = join(root, "repo")
  await mkdir(join(homeDir, ".omo"), { recursive: true })
  await mkdir(repoRoot)
  return { root, homeDir, repoRoot }
}
export function backend(overrides: Partial<IsolationBackend> = {}): IsolationBackend {
  return {
    kind: "rcopy",
    clonesTree: false,
    probe: async () => ({ available: true }),
    start: async (_lower, merged) => { await mkdir(merged) },
    stop: async () => {},
    ...overrides,
  }
}
