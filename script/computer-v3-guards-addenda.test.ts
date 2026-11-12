import { describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"

import { runGuard } from "./computer-v3-guards.ts"

// SCOPE-ADDENDA.tsv beside the plan (planner ruling R46): a line `row<TAB>path<TAB>ruling` admits exactly that
// path for exactly that row under --scope; a glob, a directory or a malformed line is a finding; no file, no change.

const env: Record<string, string> = {
  ...Object.fromEntries(
    Object.entries(process.env).filter(
      (entry): entry is [string, string] =>
        (!entry[0].startsWith("GIT_") || entry[0] === "GIT_CONFIG_GLOBAL") && entry[1] !== undefined,
    ),
  ),
  GIT_CONFIG_NOSYSTEM: "1",
}

const plan = [
  "# plan",
  "## Todos",
  "- [ ] 1. Ship the guards",
  "  Parallelization: Wave 1 (gates) | Blocked by: - | Blocks: 2, 3",
  "  Write scope: `script/computer-v3-guards.ts`",
  "- [ ] 2. Session funnel",
  "  Parallelization: Wave 2 (session) | Blocked by: 1 | Blocks: -",
  "  Write scope: `crates/omo-computer-session/src/mutate/**`",
  "- [ ] 3. Safety gates",
  "  Parallelization: Wave 2 (session) | Blocked by: 1 | Blocks: -",
  "  Write scope: `crates/omo-computer-safety/src/gate/**`",
  "## Final verification wave",
  "",
].join("\n")

const admitted = "crates/omo-computer-engine/tests/secure_audit_engine_process.rs"
const header = "# row\tpath\truling\n"

type Scope = (row: string) => { readonly exitCode: number; readonly findings: readonly string[] }

/** A repository whose one change past `base` is `admitted`, and a plan with `addenda` (if any) beside it. */
function withScope(addenda: string | undefined, body: (scope: Scope) => void): void {
  const top = mkdtempSync(join(tmpdir(), "cu-v3-addenda-"))
  const root = join(top, "repo")
  const run = join(top, "run")
  mkdirSync(root)
  mkdirSync(join(run, "evidence"), { recursive: true })
  const git = (...args: string[]): void => {
    const result = Bun.spawnSync(
      ["git", "-c", "user.name=guard-test", "-c", "user.email=guard-test@example.invalid", "-c", "commit.gpgsign=false", ...args],
      { cwd: root, env, stdout: "pipe", stderr: "pipe" },
    )
    if (result.exitCode !== 0) throw new Error(`git ${args.join(" ")} failed: ${result.stderr.toString()}`)
  }
  try {
    writeFileSync(join(run, "plan.md"), plan)
    if (addenda !== undefined) writeFileSync(join(run, "SCOPE-ADDENDA.tsv"), addenda)
    git("init", "-q", "-b", "dev")
    writeFileSync(join(root, "README.md"), "base\n")
    git("add", "-A")
    git("commit", "-q", "-m", "base")
    git("branch", "base")
    mkdirSync(dirname(join(root, admitted)), { recursive: true })
    writeFileSync(join(root, admitted), "// the engine-process proof\n")
    git("add", "-A")
    git("commit", "-q", "-m", "the admitted file")
    body((row) => runGuard(["--scope", row, "base", "--plan", join(run, "plan.md")], { cwd: root, env }))
  } finally {
    rmSync(top, { recursive: true, force: true })
  }
}

describe("computer-v3-guards --scope with SCOPE-ADDENDA.tsv", () => {
  test("an addendum line admits its exact path for its row", () => {
    withScope(`${header}2\t${admitted}\tR46\n`, (scope) => {
      const result = scope("2")
      expect(result.findings).toEqual([])
      expect(result.exitCode).toBe(0)
    })
  })

  test("the same path stays refused for any other row", () => {
    withScope(`${header}2\t${admitted}\tR46\n`, (scope) => {
      const result = scope("3")
      expect(result.findings).toEqual([`scope: ${admitted} is outside row 3's write scope`])
      expect(result.exitCode).toBe(1)
    })
  })

  test("a glob, a directory or a line without a ruling is a finding, never skipped", () => {
    const lines = [
      "2\tcrates/omo-computer-engine/tests/*.rs\tR46",
      "2\tcrates/omo-computer-engine/tests/\tR46",
      `2\t${admitted}`,
      `2\t${admitted}\tR46`,
    ]
    withScope(`${header}${lines.join("\n")}\n`, (scope) => {
      const result = scope("2")
      expect(result.exitCode).toBe(1)
      expect(result.findings).toHaveLength(3)
      for (const line of [2, 3, 4])
        expect(result.findings.filter((finding) => finding.includes(`SCOPE-ADDENDA.tsv line ${line} `))).toHaveLength(1)
    })
  })

  test("a missing addenda file changes nothing", () => {
    withScope(undefined, (scope) => {
      const result = scope("2")
      expect(result.findings).toEqual([`scope: ${admitted} is outside row 2's write scope`])
      expect(result.exitCode).toBe(1)
    })
  })
})
