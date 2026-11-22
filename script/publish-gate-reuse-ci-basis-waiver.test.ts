/// <reference types="bun-types" />

import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test"
import { spawnSync } from "node:child_process"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createGitOrigin, type GitOrigin } from "./fixtures/publish-gate-reuse-origin"

/**
 * Release contract: publish.yml gate-reuse waits for a successful hosted ci.yml run on the prepared
 * SHA unless a repository admin/maintainer dispatches a `ci_basis_receipt` whose head is the prepared
 * SHA or an ancestor that differs from it only under .github/workflows/. Executes the shipped step
 * against a real git origin, with `gh` and `sleep` stubbed as bash functions (resolved before PATH on
 * every OS): every refusal fails before any CI lookup, an empty receipt keeps the hosted wait, and an
 * accepted waiver is written with its delta to the log and the job summary.
 */

const REPOSITORY = "code-yeongyu/oh-my-openagent"
const STEP = "Require successful CI for prepared release source"
const WAIVED = "hosted CI wait waived by ci_basis_receipt"
const UNKNOWN_SHA = "0123456789abcdef0123456789abcdef01234567"
const TEST_TIMEOUT_MS = process.platform === "win32" ? 60_000 : 20_000

function stepRun(): string {
  const workflow = Bun.YAML.parse(
    readFileSync(new URL("../.github/workflows/publish.yml", import.meta.url), "utf8").replace(/\r\n/g, "\n"),
  ) as { jobs: Record<string, { steps: Array<{ name?: string; run?: string }> }> }
  const run = workflow.jobs["gate-reuse"]?.steps.find((step) => step.name === STEP)?.run
  if (!run) throw new Error(`gate-reuse has no runnable step named ${STEP}`)
  // Actions renders this expression before bash sees the script.
  return run.replaceAll("${{ github.repository }}", REPOSITORY)
}

const GH_STUB = [
  "gh() {",
  '  printf "%s\\n" "$*" >> "$GH_CALLS"',
  '  case "$*" in',
  '    *"/collaborators/"*"/permission"*)',
  '      local login="${2#*/collaborators/}"; login="${login%/permission}"',
  '      [ -n "$PERMISSION_API_DOWN" ] && return 1',
  '      local entry; for entry in $ROLES; do [ "${entry%%=*}" = "$login" ] && { printf "%s\\n" "${entry#*=}"; return 0; }; done',
  '      printf "none\\n" ;;',
  '    *"actions/workflows/ci.yml/runs"*)',
  '      printf \'{"workflow_runs":[{"id":42,"head_sha":"%s","status":"completed","conclusion":"%s","created_at":"2026-01-01T00:00:00Z","html_url":"u"}]}\' "$PREPARED_RELEASE_SHA" "$CI_CONCLUSION" ;;',
  "  esac",
  "}",
  "sleep() { :; }",
  "",
].join("\n")

const fixtureRoot = mkdtempSync(join(tmpdir(), "publish-gate-reuse-origin-"))
let fixture: GitOrigin
// Two git processes; bun's 5 s default hook budget is still too tight on a loaded runner.
beforeAll(() => {
  fixture = createGitOrigin(fixtureRoot)
}, 4 * TEST_TIMEOUT_MS)
afterAll(() => rmSync(fixtureRoot, { recursive: true, force: true }))

interface Dispatch {
  readonly prepared?: string
  readonly receipt?: string
  readonly head?: string
  readonly actor?: string
  readonly triggeringActor?: string
  readonly permissionApiDown?: boolean
  readonly ciConclusion?: string
  // Replaces the step's own LC_ALL=C. Git Bash on windows-latest keeps classifying UTF-8 characters under LC_ALL=C, so
  // its [[:print:]] matches "\u00e9" (#13955); a UTF-8 locale reproduces that on any host.
  readonly classLocale?: string
}

interface Outcome {
  readonly status: number
  readonly output: string
  readonly summary: string
  readonly ghCalls: string
}

const scratch: string[] = []
afterEach(() => {
  for (const dir of scratch.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function dispatch(input: Dispatch): Outcome {
  const root = mkdtempSync(join(tmpdir(), "publish-gate-reuse-"))
  scratch.push(root)
  const checkout = join(root, "checkout")
  fixture.initCheckout(checkout)
  const script = join(root, "step.sh")
  const summary = join(root, "summary.md")
  const ghCalls = join(root, "gh-calls")
  const run = stepRun()
  const localized =
    input.classLocale === undefined ? run : run.replace(/^(\s*)LC_ALL=C\b/gm, `$1LC_ALL=${input.classLocale}`)
  if (localized === run && input.classLocale !== undefined)
    throw new Error("the waiver step sets no LC_ALL=C to replace")
  writeFileSync(script, GH_STUB + localized)
  writeFileSync(summary, "")
  writeFileSync(ghCalls, "")
  const result = spawnSync("bash", ["-eo", "pipefail", script], {
    cwd: checkout,
    encoding: "utf8",
    timeout: TEST_TIMEOUT_MS - 1_000,
    env: {
      ...fixture.gitEnv,
      GH_CALLS: ghCalls,
      GITHUB_STEP_SUMMARY: summary,
      PREPARED_RELEASE_SHA: input.prepared ?? fixture.sha.B,
      CI_BASIS_RECEIPT: input.receipt ?? "",
      CI_BASIS_HEAD: input.head ?? "",
      ACTOR: input.actor ?? "maint",
      TRIGGERING_ACTOR: input.triggeringActor ?? input.actor ?? "maint",
      REPOSITORY,
      ROLES: "maint=maintain owner=admin dev=write",
      PERMISSION_API_DOWN: input.permissionApiDown ? "1" : "",
      CI_CONCLUSION: input.ciConclusion ?? "success",
    },
  })
  if (result.error) throw result.error
  return {
    status: result.status ?? -1,
    output: `${result.stdout}${result.stderr}`,
    summary: readFileSync(summary, "utf8"),
    ghCalls: readFileSync(ghCalls, "utf8"),
  }
}

const RECEIPT = "ci-basis-20261116-01"

describe("publish.yml gate-reuse ci_basis_receipt waiver", () => {
  test.each([
    ["an empty prepared_release_sha", () => ({ head: fixture.sha.A, prepared: "" }), "prepared_release_sha is empty"],
    [
      "a short prepared_release_sha",
      () => ({ head: fixture.sha.A, prepared: fixture.sha.B.slice(0, 12) }),
      "prepared_release_sha must be a full 40-character",
    ],
    ["a short head", () => ({ head: fixture.sha.A.slice(0, 12) }), "ci_basis_head must be a full 40-character"],
    ["an uppercase head", () => ({ head: fixture.sha.A.toUpperCase() }), "ci_basis_head must be a full 40-character"],
    ["a receipt with a newline", () => ({ head: fixture.sha.A, receipt: "r1\n::warning::x" }), "1-128 printable ASCII"],
    ["a receipt with a tab", () => ({ head: fixture.sha.A, receipt: "r1\tr2" }), "1-128 printable ASCII"],
    ["a 129-character receipt", () => ({ head: fixture.sha.A, receipt: "r".repeat(129) }), "1-128 printable ASCII"],
    ["a non-ASCII receipt", () => ({ head: fixture.sha.A, receipt: "r\u00e9ceipt" }), "1-128 printable ASCII"],
    ["a write-role actor", () => ({ head: fixture.sha.A, actor: "dev" }), "dev has repository role 'write'"],
    [
      "a non-collaborator actor",
      () => ({ head: fixture.sha.A, actor: "stranger" }),
      "stranger has repository role 'none'",
    ],
    [
      "a maintainer re-run triggered by a write-role user",
      () => ({ head: fixture.sha.A, triggeringActor: "dev" }),
      "dev has repository role 'write'",
    ],
    ["a bot actor", () => ({ head: fixture.sha.A, actor: "github-actions[bot]" }), "is not a GitHub user login"],
    [
      "an unreadable permission",
      () => ({ head: fixture.sha.A, permissionApiDown: true }),
      "could not read the repository permission",
    ],
    ["a head the origin does not have", () => ({ head: UNKNOWN_SHA }), "could not fetch ci_basis_head"],
    [
      "a sibling head that is not an ancestor",
      () => ({ head: fixture.sha.D }),
      "is not an ancestor of prepared_release_sha",
    ],
    [
      "a head that descends from the prepared SHA",
      () => ({ head: fixture.sha.B, prepared: fixture.sha.A }),
      "is not an ancestor of prepared_release_sha",
    ],
    [
      "a delta with a source file",
      () => ({ head: fixture.sha.A, prepared: fixture.sha.C }),
      "changes files outside .github/workflows/: src/a.ts",
    ],
    [
      "a non-workflow .github/ file",
      () => ({ head: fixture.sha.A, prepared: fixture.sha.E }),
      "changes files outside .github/workflows/: .github/scripts/summary.sh",
    ],
    [
      "a source file renamed into .github/workflows/",
      () => ({ head: fixture.sha.A, prepared: fixture.sha.R }),
      "changes files outside .github/workflows/: src/a.ts",
    ],
  ] as const)(
    "#given %s #when the waiver is requested #then gate-reuse refuses before reading CI",
    (_label, input, reason) => {
      const outcome = dispatch({ receipt: RECEIPT, ...input() })
      expect(outcome.status).not.toBe(0)
      expect(outcome.output).toContain("::error::ci_basis_receipt refused: ")
      expect(outcome.output).toContain(reason)
      expect(outcome.ghCalls).not.toContain("actions/workflows/ci.yml/runs")
      expect(outcome.summary).not.toContain(WAIVED)
    },
    TEST_TIMEOUT_MS,
  )

  test.each([
    ["a maintainer, equal heads", "maint", () => [fixture.sha.C, fixture.sha.C] as const, ""],
    [
      "an admin, a workflow-only delta",
      "owner",
      () => [fixture.sha.A, fixture.sha.B] as const,
      ".github/workflows/publish.yml | 1 +",
    ],
  ] as const)(
    "#given %s #when gate-reuse runs #then it skips the hosted wait and logs the waiver with its delta",
    (_label, actor, heads, stat) => {
      const [head, prepared] = heads()
      const outcome = dispatch({ receipt: RECEIPT, head, prepared, actor })
      expect(outcome.status).toBe(0)
      expect(outcome.ghCalls).toContain(`repos/${REPOSITORY}/collaborators/${actor}/permission`)
      expect(outcome.ghCalls).not.toContain("actions/workflows/ci.yml/runs")
      const lines = outcome.summary.split("\n").map((line) => line.trim())
      const expected = [
        `- ci_basis_receipt: ${RECEIPT}`,
        `- ci_basis_head: ${head}`,
        `- prepared_release_sha: ${prepared}`,
        `- actor: ${actor} (triggered by ${actor})`,
        `- ${WAIVED}`,
        `Workflow-only delta (git diff --stat ${head}..${prepared}):`,
      ]
      expect(lines).toEqual(expect.arrayContaining(expected))
      for (const line of expected) expect(outcome.output).toContain(line)
      if (stat) expect(lines).toContain(stat)
      else expect(outcome.summary).not.toContain("file changed")
    },
    TEST_TIMEOUT_MS,
  )

  test(
    "#given a non-ASCII receipt #when bash classifies characters as UTF-8 under LC_ALL=C (Git Bash) #then gate-reuse still refuses",
    () => {
      // The simulated locale must really make [[:print:]] accept the character, or this case proves nothing.
      const probe = spawnSync("bash", ["-c", 'LC_ALL=C.UTF-8; [[ "$R" =~ ^[[:print:]]+$ ]]'], {
        env: { ...process.env, R: "r\u00e9ceipt" },
      })
      expect(probe.status).toBe(0)
      const outcome = dispatch({ receipt: "r\u00e9ceipt", head: fixture.sha.A, classLocale: "C.UTF-8" })
      expect(outcome.status).not.toBe(0)
      expect(outcome.output).toContain("::error::ci_basis_receipt refused: ")
      expect(outcome.output).toContain("1-128 printable ASCII")
      expect(outcome.summary).not.toContain(WAIVED)
    },
    TEST_TIMEOUT_MS,
  )

  test(
    "#given an empty receipt #when the prepared SHA has a successful hosted run #then gate-reuse reads ci.yml and never checks permissions",
    () => {
      const outcome = dispatch({ head: UNKNOWN_SHA, actor: "dev" })
      expect(outcome.status).toBe(0)
      expect(outcome.output).toContain(`CI workflow run 42 succeeded for ${fixture.sha.B}.`)
      expect(outcome.ghCalls).toContain(`repos/${REPOSITORY}/actions/workflows/ci.yml/runs`)
      expect(outcome.ghCalls).not.toContain("/permission")
      expect(outcome.summary).toBe("")
    },
    TEST_TIMEOUT_MS,
  )

  test(
    "#given an empty receipt #when the hosted run failed #then gate-reuse still refuses",
    () => {
      const outcome = dispatch({ ciConclusion: "failure" })
      expect(outcome.status).not.toBe(0)
      expect(outcome.output).toContain(`::error::CI completed without a successful run for ${fixture.sha.B}.`)
    },
    TEST_TIMEOUT_MS,
  )
})
