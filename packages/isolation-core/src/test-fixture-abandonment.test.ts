import { describe, expect, test } from "bun:test"
import { spawnSync } from "node:child_process"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

describe("fixture ownership of in-flight git work", () => {
  test("#given a test abandoned mid-git #when the next test builds its own fixture #then the abandoned child is settled by the abandoned fixture and the next fixture stays intact", () => {
    const runRoot = mkdtempSync(join(tmpdir(), "isolation-abandonment-"))
    try {
      const abandoned = join(runRoot, "abandoned.test.ts")
      writeFileSync(
        abandoned,
        [
          'import { test } from "bun:test"',
          `import { git, repo } from ${JSON.stringify(join(import.meta.dir, "backends", "git-fixture"))}`,
          "",
          "test('abandoned mid-git', async () => {",
          "  const f = await repo()",
          "  // A batch read waits on stdin forever, so this test is abandoned while the git child runs.",
          "  void git(f.repoRoot, 'cat-file', '--batch')",
          "  await new Promise(() => undefined)",
          "}, 300)",
          "",
          "test('next fixture', async () => {",
          "  const f = await repo()",
          "  await git(f.repoRoot, 'status', '--porcelain')",
          "})",
        ].join("\n"),
      )
      const run = spawnSync(process.execPath, ["test", "--timeout", "8000", abandoned], {
        encoding: "utf8",
        timeout: 60_000,
      })
      const output = `${run.stdout}\n${run.stderr}`
      expect(output, `exit ${run.status}`).toContain("(pass) next fixture")
      expect(output).not.toContain("(fail) next fixture")
      expect(output).not.toContain("Unhandled error")
    } finally {
      rmSync(runRoot, { recursive: true, force: true })
    }
  })
})
