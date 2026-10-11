import { onTestFinished } from "bun:test"
import { mkdtemp, mkdir } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import type { IsolationBackend } from "./backend"
import { removeTree } from "../../../test-support/remove-tree"

export async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "isolation-core-"))
  // Per test, not a module-level afterEach: bun binds a helper module's hook only to the first test file that
  // imports it, so every other file leaked its roots (#9766). win32 tears a killed tree down asynchronously and a
  // survivor keeps its directory locked, so the removal retries (the EBUSY family #8610 absorbed).
  onTestFinished(() => removeTree(root, { maxRetries: 10, retryDelay: 500 }))
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
