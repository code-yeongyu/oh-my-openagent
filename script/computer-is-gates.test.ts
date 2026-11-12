import { describe, expect, test } from "bun:test"

import { type FixtureRepo, withFixtureRepo } from "./computer-is-fixture-repo.ts"
import { runGates } from "./computer-is-gates.ts"

// The gate checker answers one question for the ideal-state program: which cu-v3 rows have landed on the
// integration branch. A row counts only when its pull request was merged INTO that branch (a merge commit on the
// first-parent line whose subject names a `<prefix>/cu-v3-row<N>-` head), so a pull request merged into another
// row's branch is not counted until that branch itself lands. Each case builds the history it needs in a
// temporary repository and reads the checker's printed verdict and exit code.

const gatesConfig = (gates: Record<string, { rows: number[]; artifacts: string[] }>): string =>
  `${JSON.stringify({ gates }, null, 2)}\n`

/** Lands `branch` on dev the way GitHub does: a no-fast-forward merge commit with the pull request subject. */
function landPullRequest(repo: FixtureRepo, pr: number, branch: string, files: Record<string, string>): void {
  repo.git("checkout", "-q", "-b", branch, "dev")
  repo.write(files)
  repo.commit(`work on ${branch}`)
  repo.git("checkout", "-q", "dev")
  repo.git("merge", "-q", "--no-ff", "-m", `Merge pull request #${pr} from owner/${branch}`, branch)
}

function seed(repo: FixtureRepo, gates: Record<string, { rows: number[]; artifacts: string[] }>): void {
  repo.write({ "script/computer-is-gates.json": gatesConfig(gates) })
  repo.commit("seed gates")
}

describe("computer-is-gates --gate", () => {
  test("a gate whose rows all merged into dev and whose artifacts exist passes", () => {
    withFixtureRepo((repo) => {
      seed(repo, { contract: { rows: [2, 12], artifacts: ["crates/core/schema.json"] } })
      landPullRequest(repo, 101, "chore/cu-v3-row2-guards", { "script/guards.ts": "export {}\n" })
      landPullRequest(repo, 102, "feat/cu-v3-row12-core", { "crates/core/schema.json": "{}\n" })

      const result = runGates(["--gate", "contract", "--ref", "dev"], repo.options)

      expect(result.lines).toEqual(["GATE contract PASS rows=2,12 missing=0"])
      expect(result.exitCode).toBe(0)
    })
  })

  test("an unmerged row is named, and row 1 is not satisfied by row 12's branch", () => {
    withFixtureRepo((repo) => {
      seed(repo, { spine: { rows: [1, 12, 14], artifacts: [] } })
      landPullRequest(repo, 102, "feat/cu-v3-row12-core", { "a.txt": "a\n" })

      const result = runGates(["--gate", "spine", "--ref", "dev"], repo.options)

      expect(result.lines).toEqual(["GATE spine FAIL missing=1,14"])
      expect(result.exitCode).toBe(1)
    })
  })

  test("a pull request merged into another row's branch is not counted until that branch lands", () => {
    withFixtureRepo((repo) => {
      seed(repo, { spine: { rows: [14, 15], artifacts: [] } })
      repo.git("checkout", "-q", "-b", "feat/cu-v3-row14-fake", "dev")
      repo.write({ "fake.rs": "// row 14\n" })
      repo.commit("row 14 work")
      repo.git("checkout", "-q", "-b", "feat/cu-v3-row15-followup", "feat/cu-v3-row14-fake")
      repo.write({ "followup.rs": "// row 15\n" })
      repo.commit("row 15 work")
      repo.git("checkout", "-q", "feat/cu-v3-row14-fake")
      repo.git(
        "merge",
        "-q",
        "--no-ff",
        "-m",
        "Merge pull request #201 from owner/feat/cu-v3-row15-followup",
        "feat/cu-v3-row15-followup",
      )
      repo.git("checkout", "-q", "dev")

      expect(runGates(["--gate", "spine", "--ref", "dev"], repo.options).lines).toEqual([
        "GATE spine FAIL missing=14,15",
      ])

      repo.git(
        "merge",
        "-q",
        "--no-ff",
        "-m",
        "Merge pull request #200 from owner/feat/cu-v3-row14-fake",
        "feat/cu-v3-row14-fake",
      )
      const landed = runGates(["--gate", "spine", "--ref", "dev"], repo.options)

      // the row 15 merge now sits in dev's history, but only on the second-parent side: still missing
      expect(landed.lines).toEqual(["GATE spine FAIL missing=15"])
      expect(landed.exitCode).toBe(1)
    })
  })

  test("an artifact absent at the checked ref is named even when every row merged", () => {
    withFixtureRepo((repo) => {
      seed(repo, { contract: { rows: [2], artifacts: ["script/guards.ts", "crates/core/missing.json"] } })
      landPullRequest(repo, 101, "chore/cu-v3-row2-guards", { "script/guards.ts": "export {}\n" })

      const result = runGates(["--gate", "contract", "--ref", "dev"], repo.options)

      expect(result.lines).toEqual(["GATE contract FAIL missing=path:crates/core/missing.json"])
      expect(result.exitCode).toBe(1)
    })
  })

  test("an unknown gate, a missing gate name and a bad option are usage errors that exit 2", () => {
    withFixtureRepo((repo) => {
      seed(repo, { contract: { rows: [2], artifacts: [] } })

      const unknown = runGates(["--gate", "nope", "--ref", "dev"], repo.options)
      expect(unknown.exitCode).toBe(2)
      expect(unknown.lines).toEqual(["GATE nope UNKNOWN known=contract"])
      expect(runGates(["--gate"], repo.options).exitCode).toBe(2)
      expect(runGates(["--frobnicate"], repo.options).exitCode).toBe(2)
    })
  })

  test("a ref that does not resolve is a failure that names it, never a pass", () => {
    withFixtureRepo((repo) => {
      seed(repo, { contract: { rows: [2], artifacts: [] } })

      const result = runGates(["--gate", "contract", "--ref", "no-such-ref"], repo.options)

      expect(result.exitCode).toBe(1)
      expect(result.lines).toHaveLength(1)
      expect(result.lines[0]).toStartWith("GATE contract ERROR ")
      expect(result.lines[0]).toContain("no-such-ref")
    })
  })

  test("an empty artifact path or a gate with nothing to check is a config failure, never a pass", () => {
    for (const gate of [
      { rows: [2], artifacts: [""] },
      { rows: [], artifacts: [] },
    ]) {
      withFixtureRepo((repo) => {
        seed(repo, { contract: gate })

        const result = runGates(["--gate", "contract", "--ref", "dev"], repo.options)

        expect(result.exitCode).toBe(1)
        expect(result.lines).toHaveLength(1)
        expect(result.lines[0]).toStartWith("GATE config ERROR gate contract: ")
      })
    }
  })

  test("a malformed gate config fails with the reason instead of checking nothing", () => {
    withFixtureRepo((repo) => {
      repo.write({ "script/computer-is-gates.json": `${JSON.stringify({ gates: { contract: { rows: ["2"] } } })}\n` })
      repo.commit("bad config")

      const result = runGates(["--gate", "contract", "--ref", "dev"], repo.options)

      expect(result.exitCode).toBe(1)
      expect(result.lines[0]).toStartWith("GATE config ERROR ")
    })
  })
})

describe("computer-is-gates --list", () => {
  test("prints every gate with its rows and artifact count", () => {
    withFixtureRepo((repo) => {
      seed(repo, { contract: { rows: [2, 3], artifacts: ["a"] }, spine: { rows: [14], artifacts: [] } })

      const result = runGates(["--list"], repo.options)

      expect(result.lines).toEqual(["GATE contract rows=2,3 artifacts=1", "GATE spine rows=14 artifacts=0"])
      expect(result.exitCode).toBe(0)
    })
  })
})
