import { expect, test } from "bun:test"
import { spawnSync } from "node:child_process"
import { mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { releaseStepTemp } from "./fixtures/publish-gate-reuse-origin"

test("Git Bash stages a Node entrypoint inside the case directory and cleans it up", () => {
  const root = mkdtempSync(join(tmpdir(), "publish temp "))
  try {
    const workflow = readFileSync(new URL("../.github/workflows/publish.yml", import.meta.url), "utf8")
    const allocations = [...workflow.matchAll(/^\s*(proof_dir="\$\(mktemp[^\n]+\)")\s*$/gm)].map((m) => m[1]?.trim())
    expect(allocations.length).toBeGreaterThan(0)
    expect(new Set(allocations).size).toBe(1)
    const result = spawnSync(
      "bash",
      [
        "-eu",
        "-c",
        `
      ${allocations[0]}
      trap 'rm -rf "$proof_dir"' EXIT
      printf '%s\\n' 'import {realpathSync} from "node:fs"; import {dirname} from "node:path"; console.log(realpathSync(dirname(dirname(process.argv[1]))))' > "$proof_dir/proof.mjs"
      node "$proof_dir/proof.mjs"
    `,
      ],
      {
        cwd: root,
        env: { PATH: process.env.PATH ?? "", HOME: root, ...releaseStepTemp(root) },
        encoding: "utf8",
      },
    )
    expect(result.status, result.stderr).toBe(0)
    expect(result.stdout.trim()).toBe(realpathSync(root))
    expect(readdirSync(root)).toEqual([])
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
