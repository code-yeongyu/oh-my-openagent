import { expect, test } from "bun:test"
import { mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { runReleaseBash } from "./fixtures/publish-gate-reuse-origin"

test("Git Bash stages a Node entrypoint inside the case directory and cleans it up", () => {
  const root = mkdtempSync(join(tmpdir(), "publish temp "))
  try {
    const workflow = readFileSync(new URL("../.github/workflows/publish.yml", import.meta.url), "utf8")
    const allocations = [...workflow.matchAll(/^\s*(proof_dir="\$\(mktemp[^\n]+\)")\s*$/gm)].map((m) => m[1]?.trim())
    expect(allocations.length).toBeGreaterThan(0)
    expect(new Set(allocations).size).toBe(1)
    const script = join(root, "step.sh")
    writeFileSync(
      script,
      `
      ${allocations[0]}
      printf '%s\\n' 'import {realpathSync} from "node:fs"; import {dirname} from "node:path"; console.log(realpathSync(dirname(dirname(process.argv[1]))))' > "$proof_dir/proof.mjs"
      node "$proof_dir/proof.mjs"
      exit 23
    `,
    )
    const result = runReleaseBash(root, script, {
      cwd: root,
      env: { PATH: process.env.PATH ?? "", HOME: root },
      encoding: "utf8",
    })
    expect(result.status, result.stderr).toBe(23)
    expect(dirname(result.stdout.trim())).toBe(realpathSync(root))
    expect(readdirSync(root)).toEqual(["step.sh"])
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
