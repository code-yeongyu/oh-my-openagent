import { expect, test } from "bun:test"
import { spawnSync } from "node:child_process"
import { mkdtempSync, readdirSync, realpathSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { releaseStepTemp } from "./fixtures/publish-gate-reuse-origin"

test("Git Bash stages a Node entrypoint inside the case directory and cleans it up", () => {
  const root = mkdtempSync(join(tmpdir(), "publish temp "))
  try {
    const result = spawnSync(
      "bash",
      [
        "-eu",
        "-c",
        `
      proof_dir="$(mktemp -d)"
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
