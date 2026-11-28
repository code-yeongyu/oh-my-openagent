import { expect, test } from "bun:test"
import { spawnSync } from "node:child_process"
import { join } from "node:path"

const repoRoot = join(import.meta.dir, "../../../../..")
const sessionManagerDir = "./packages/omo-opencode/src/tools/session-manager"
const CHILD_BUDGET_MS = 120_000

test.each(["storage.test.ts", "storage-fallback.test.ts"])(
  "#given %s ran alone in this process #when a later file reads the shared storage paths #then none points into its fixture (#13286)",
  (storageFile) => {
    const files = [storageFile, "storage-paths-not-redirected.test.ts"]
    const run = spawnSync(
      process.execPath,
      ["test", "--timeout", "20000", ...files.map((file) => `${sessionManagerDir}/${file}`)],
      { cwd: repoRoot, encoding: "utf8", timeout: CHILD_BUDGET_MS },
    )
    const output = `${run.stdout ?? ""}${run.stderr ?? ""}`
    if (run.error !== undefined || run.signal !== null) {
      throw new Error(`child bun test did not complete (${run.error?.message ?? run.signal}):\n${output}`)
    }

    expect(output).toContain("(pass) later file: no storage path or helper still points into a session-manager fixture")
    expect(output).not.toContain("temp entr")
    expect(run.status).toBe(0)
  },
  CHILD_BUDGET_MS + 10_000,
)
