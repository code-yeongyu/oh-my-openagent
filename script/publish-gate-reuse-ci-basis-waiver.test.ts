/// <reference types="bun-types" />

import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test"
import { spawnSync } from "node:child_process"
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { CI_YML_PATH, ciJobs, VALIDATIONS, type Validation, YQ_TO_JSON } from "./fixtures/publish-ci-validation"
import { createGitOrigin, type GitOrigin, runReleaseBash } from "./fixtures/publish-gate-reuse-origin"

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

/** The receipt artifact the parent's dispatch job uploads, rendered for one source, prepared SHA and CI run. */
function parentReceipt(source: string, prepared: string, run: string): string {
  const workflow = Bun.YAML.parse(
    readFileSync(new URL("../.github/workflows/publish.yml", import.meta.url), "utf8").replace(/\r\n/g, "\n"),
  ) as { jobs: Record<string, { steps: Array<{ uses?: string; with?: { name?: string } }> }> }
  const name = workflow.jobs["dispatch-provenance-safe-publish"]?.steps.find((step) =>
    step.uses?.startsWith("actions/upload-artifact@"),
  )?.with?.name
  if (!name) throw new Error("dispatch-provenance-safe-publish uploads no receipt artifact")
  const values: Record<string, string> = {
    "needs.pin-ci.outputs.source_sha": source,
    "needs.prepare-release-state.outputs.release_sha": prepared,
    "needs.pin-ci.outputs.ci_run_id": run,
  }
  return name.replace(/\$\{\{\s*([\w.-]+)\s*\}\}/g, (_match, expression: string) => {
    const value = values[expression]
    if (value === undefined) throw new Error(`unexpected expression ${expression} in the receipt name`)
    return value
  })
}

function stepRun(): string {
  const workflow = Bun.YAML.parse(
    readFileSync(new URL("../.github/workflows/publish.yml", import.meta.url), "utf8").replace(/\r\n/g, "\n"),
  ) as { jobs: Record<string, { steps: Array<{ name?: string; run?: string }> }> }
  const run = workflow.jobs["gate-reuse"]?.steps.find((step) => step.name === STEP)?.run
  if (!run) throw new Error(`gate-reuse has no runnable step named ${STEP}`)
  // Actions renders this expression before bash sees the script.
  return run.replaceAll("${{ github.repository }}", REPOSITORY)
}

// RUN_LEGS / BASE_LEGS: the Windows leg of hosted run 42 and of the base's dev push run 7 (success, failure, or
// skipped = passed with its test step skipped). The jobs and dev-run answers go through the caller's --jq filter, so the
// shipped platform-jobs.jq is what classifies them; the stub is exported so base-platform-green.sh sees it too.
const GH_STUB = [
  // The run pin-ci dispatched for the pin (id 55 on release-ci/<pin>-1-1): OWNED_STATES lists its status:conclusion per
  // read, the last one repeating; OWNED_BRANCH / OWNED_ACTOR override its branch and triggering actor; OWNED_RED_JOB is a
  // job of it that already failed. ci.yml is workflow 11 and publish.yml workflow 12; run 1 is the parent release attempt
  // the default ref names, of workflow PARENT_WORKFLOW; PARENT_RECEIPT is the one receipt artifact it recorded (by default
  // the one dispatch-provenance-safe-publish uploads for this source, this prepared SHA and run 55).
  "owned_state() {",
  '  local n=0 IFS=,; [ -f "$STATE_DIR/owned-reads" ] && n=$(cat "$STATE_DIR/owned-reads"); printf "%s" $((n + 1)) > "$STATE_DIR/owned-reads"',
  "  local states=($OWNED_STATES) state; state=${states[$n]:-${states[${#states[@]}-1]}}",
  '  printf \'{"id":55,"workflow_id":%s,"created_at":"2026-01-01T00:05:00Z","run_attempt":1,"head_sha":"%s","event":"workflow_dispatch","head_branch":"%s","triggering_actor":{"login":"%s"},"status":"%s","conclusion":%s}\' "${OWNED_WORKFLOW:-11}" "$SOURCE_SHA_LOWER" "${OWNED_BRANCH:-release-ci/$SOURCE_SHA_LOWER-1-1}" "${OWNED_ACTOR:-github-actions[bot]}" "${state%%:*}" "$([ -n "${state#*:}" ] && printf \'"%s"\' "${state#*:}" || printf null)"',
  "}",
  "leg_jobs() {",
  '  local test_step="$1" conclusion="$1"',
  '  [ "$1" = skipped ] && conclusion=success',
  '  printf \'{"jobs":[{"name":"test (windows-latest, 1/2)","conclusion":"%s","html_url":"u","labels":["windows-latest"],"steps":[{"name":"Set up job","conclusion":"success"},{"name":"Run tests","conclusion":"%s"}]}]}\' "$conclusion" "$test_step"',
  "}",
  "gh() {",
  '  printf "%s\\n" "$*" >> "$GH_CALLS"',
  '  local filter="" previous="" argument',
  '  for argument in "$@"; do [ "$previous" = --jq ] && filter="$argument"; previous="$argument"; done',
  '  case "$*" in',
  '    *"/actions/runs/42/jobs"*) leg_jobs "$RUN_LEGS" | jq -r "$filter" ;;',
  '    *"/actions/runs/7/jobs"*) leg_jobs "$BASE_LEGS" | jq -r "$filter" ;;',
  '    *"/actions/runs/55 "*) owned_state | jq -r "$filter" ;;',
  '    *"/actions/workflows/ci.yml "*) echo \'{"id":11}\' | jq -r "$filter" ;;',
  '    *"/actions/workflows/publish.yml "*) echo \'{"id":12}\' | jq -r "$filter" ;;',
  '    *"/actions/runs/1/artifacts "*) [ -n "$RECEIPT_API_DOWN" ] && return 1; local wanted="$*"; wanted="${wanted##*name=}"; wanted="${wanted%% *}"; local n=0; [ "$wanted" = "$PARENT_RECEIPT" ] && n=1; printf \'{"artifacts":[%s]}\' "$([ "$n" = 1 ] && printf \'{"name":"%s","workflow_run":{"id":1}}\' "$wanted")" | jq -r "$filter" ;;',
  '    *"/actions/runs/1 "*) [ -n "$PARENT_API_DOWN" ] && return 1; printf \'{"workflow_id":%s,"event":"workflow_dispatch","run_attempt":1,"created_at":"2026-01-01T00:00:00Z"}\' "${PARENT_WORKFLOW:-12}" | jq -r "$filter" ;;',
  '    *"/actions/runs/55/jobs?filter=latest"*) if [ -n "$OWNED_RED_JOB" ]; then printf \'{"jobs":[{"name":"%s","status":"completed","conclusion":"failure"}]}\' "$OWNED_RED_JOB"; else printf \'{"jobs":[{"name":"typecheck","status":"in_progress","conclusion":null}]}\'; fi | jq -r "$filter" ;;',
  '    *"/actions/runs/55/attempts/1/jobs?"*) cat "$OWNED_JOBS" ;;',
  '    *"actions/workflows/ci.yml/runs?branch=dev"*)',
  '      local base="${2##*head_sha=}"; base="${base%%&*}"',
  '      printf \'{"workflow_runs":[{"id":7,"created_at":"2026-01-01T00:00:00Z","conclusion":"success","head_sha":"%s","head_branch":"dev","event":"push","status":"completed"}]}\' "$base" | jq -r "$filter" ;;',
  '    *"/collaborators/"*"/permission"*)',
  '      local login="${2#*/collaborators/}"; login="${login%/permission}"',
  '      [ -n "$PERMISSION_API_DOWN" ] && return 1',
  '      local entry; for entry in $ROLES; do [ "${entry%%=*}" = "$login" ] && { printf "%s\\n" "${entry#*=}"; return 0; }; done',
  '      printf "none\\n" ;;',
  '    *"actions/workflows/ci.yml/runs"*)',
  '      local sha id=42 event=pull_request conclusion="$CI_CONCLUSION"; for arg in "$@"; do case "$arg" in head_sha=*) sha="${arg#head_sha=}" ;; event=push) event=push; conclusion="$PUSH_CONCLUSION"; if [ "$sha" = "$PREPARED_RELEASE_SHA" ]; then conclusion="$STAMP_PUSH_CONCLUSION"; else id=41; fi ;; esac; done',
  '      printf \'{"workflow_runs":[{"id":%s,"run_attempt":2,"event":"%s","head_sha":"%s","status":"completed","conclusion":"%s","created_at":"2026-01-01T00:00:00Z","html_url":"u"}]}\' "$id" "$event" "$sha" "$conclusion" ;;',
  '    *"/actions/runs/41/attempts/2/jobs?"*) cat "$PIN_JOBS" ;;',
  '    *"/actions/runs/42/attempts/2/jobs?"*) cat "$STAMP_JOBS" ;;',
  '    *"/contents/.github/workflows/ci.yml?ref="*) cat "$CI_YML" ;;',
  "    *) return 1 ;;",
  "  esac",
  "}",
  "export -f gh leg_jobs",
  "sleep() { :; }",
  `yq() { [ "$1" = -o=json ] || return 1; ${YQ_TO_JSON}; }`,
  "",
].join("\n")

// The step reads these from its checkout (the dispatch ref); the test checkout is empty, so they are copied in.
const STEP_FILES = [
  ".github/scripts/release-source-admission.sh",
  ".github/scripts/platform-jobs.jq",
  ".github/scripts/base-platform-green.sh",
  "script/release-state-paths.mjs",
]

const fixtureRoot = mkdtempSync(join(tmpdir(), "publish-gate-reuse-origin-"))
let fixture: GitOrigin
// Two git processes; bun's 5 s default hook budget is still too tight on a loaded runner.
beforeAll(() => {
  fixture = createGitOrigin(fixtureRoot)
}, 4 * TEST_TIMEOUT_MS)
afterAll(() => rmSync(fixtureRoot, { recursive: true, force: true }))

interface Dispatch {
  readonly mirrorTip?: string
  readonly pin?: string
  readonly pushConclusion?: string
  readonly stampPushConclusion?: string
  readonly pinValidation?: Validation
  readonly stampValidation?: Validation
  /** ci.yml served for the exact push SHA; the repository's own by default. */
  readonly ciYml?: string
  readonly prepared?: string
  readonly receipt?: string
  readonly head?: string
  readonly actor?: string
  readonly triggeringActor?: string
  readonly permissionApiDown?: boolean
  readonly ciConclusion?: string
  readonly runLegs?: "success" | "failure" | "skipped"
  readonly baseLegs?: "success" | "failure" | "skipped"
  /** pin-ci's run for the pin (id 55): its status:conclusion on each read, the last repeating. */
  readonly ownedStates?: readonly string[]
  readonly ownedBranch?: string
  readonly ownedActor?: string
  readonly ownedWorkflow?: string
  readonly parentWorkflow?: string
  readonly parentReceipt?: string
  readonly receiptApiDown?: boolean
  readonly parentApiDown?: boolean
  readonly ownedRedJob?: string
  /** The tagged child carries the parent's run id without its ref name; the parent knows the exact ref. */
  readonly ownedInChild?: boolean
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
  const prepared = input.prepared ?? fixture.sha.B
  if (input.pin) {
    const git = (args: string[]) => {
      const result = spawnSync("git", args, { cwd: checkout, env: fixture.gitEnv, encoding: "utf8" })
      if (result.status !== 0) throw new Error(result.stderr)
    }
    git(["fetch", "origin"])
    git(["update-ref", "refs/remotes/origin/master", input.mirrorTip ?? fixture.sha.A])
    git(["checkout", "--detach", prepared || "origin/dev"])
  }
  for (const path of STEP_FILES) {
    mkdirSync(join(checkout, dirname(path)), { recursive: true })
    copyFileSync(new URL(`../${path}`, import.meta.url), join(checkout, path))
  }
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
  const ciYml = join(root, "ci.yml")
  writeFileSync(ciYml, input.ciYml ?? readFileSync(CI_YML_PATH, "utf8"))
  const pinJobs = join(root, "pin-jobs.json")
  writeFileSync(pinJobs, ciJobs(input.pinValidation))
  const stampJobs = join(root, "stamp-jobs.json")
  writeFileSync(stampJobs, ciJobs(input.stampValidation))
  const ownedJobs = join(root, "owned-jobs.json")
  writeFileSync(ownedJobs, ciJobs("passed"))
  const result = runReleaseBash(root, script, {
    cwd: checkout,
    encoding: "utf8",
    timeout: TEST_TIMEOUT_MS - 1_000,
    env: {
      ...fixture.gitEnv,
      GH_CALLS: ghCalls,
      GITHUB_STEP_SUMMARY: summary,
      GITHUB_OUTPUT: join(root, "output"),
      SOURCE_SHA: input.pin ?? "",
      GITHUB_SHA: prepared || fixture.sha.T,
      LAZYCODEX_ONLY: "false",
      PUSH_CONCLUSION: input.pushConclusion ?? "success",
      STAMP_PUSH_CONCLUSION: input.stampPushConclusion ?? "success",
      PIN_JOBS: pinJobs,
      STAMP_JOBS: stampJobs,
      OWNED_JOBS: ownedJobs,
      CI_YML: ciYml,
      BUN_EXE: process.execPath,
      PREPARED_RELEASE_SHA: prepared,
      CI_BASIS_RECEIPT: input.receipt ?? "",
      CI_BASIS_HEAD: input.head ?? "",
      ACTOR: input.actor ?? "maint",
      TRIGGERING_ACTOR: input.triggeringActor ?? input.actor ?? "maint",
      REPOSITORY,
      ROLES: "maint=maintain owner=admin dev=write",
      PERMISSION_API_DOWN: input.permissionApiDown ? "1" : "",
      CI_CONCLUSION: input.ciConclusion ?? "success",
      RUN_LEGS: input.runLegs ?? "success",
      BASE_LEGS: input.baseLegs ?? "success",
      RELEASE_CI_RUN: input.ownedStates ? "55" : "",
      OWNED_STATES: (input.ownedStates ?? []).join(","),
      RELEASE_CI_REF:
        input.ownedStates && !input.ownedInChild ? `release-ci/${(input.pin ?? "").toLowerCase()}-1-1` : "",
      OWNED_BRANCH: input.ownedBranch ?? "",
      OWNED_ACTOR: input.ownedActor ?? "",
      OWNED_WORKFLOW: input.ownedWorkflow ?? "",
      PARENT_WORKFLOW: input.parentWorkflow ?? "",
      RECEIPT_API_DOWN: input.receiptApiDown ? "1" : "",
      PARENT_API_DOWN: input.parentApiDown ? "1" : "",
      PARENT_RECEIPT: input.parentReceipt ?? parentReceipt((input.pin ?? "").toLowerCase(), prepared, "55"),
      OWNED_RED_JOB: input.ownedRedJob ?? "",
      SOURCE_SHA_LOWER: (input.pin ?? "").toLowerCase(),
      STATE_DIR: root,
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

describe("#given a pinned release", () => {
  test.each(VALIDATIONS)(
    "the parent requires closed-world validation evidence (%s) even if the pin push is green",
    (validation) => {
      const result = dispatch({ pin: fixture.sha.B, prepared: "", pinValidation: validation })
      expect(result.status === 0, result.output).toBe(validation === "passed" || validation === "allowed-skip")
      if (result.status !== 0 && validation !== "empty-response")
        expect(result.output).toContain("update the release proof contract")
      expect(result.ghCalls).toContain("/actions/runs/41/attempts/2/jobs?")
    },
  )

  test.each(["skipped-job", "skipped-step", "passed"] as const)(
    "the child requires independent validation evidence (%s) for an exact non-stamp push",
    (validation) => {
      const result = dispatch({ pin: fixture.sha.A, prepared: fixture.sha.B, stampValidation: validation })
      expect(result.status === 0, result.output).toBe(validation === "passed")
      expect(result.ghCalls).toContain("/actions/runs/41/attempts/2/jobs?")
      expect(result.ghCalls).toContain("/actions/runs/42/attempts/2/jobs?")
    },
  )

  test("#when the source is malformed or outside dev #then it cannot start preparation", () => {
    for (const pin of ["dev", fixture.sha.B.slice(0, 12), fixture.sha.D]) {
      const result = dispatch({ pin, prepared: "" })
      expect(result.status).not.toBe(0)
      expect(result.ghCalls).toBe("")
    }
  })

  test("a pin on dev that cannot fast-forward master is refused before CI lookup or stamping", () => {
    const result = dispatch({ pin: fixture.sha.B, prepared: "", mirrorTip: fixture.sha.D })
    expect(result.status).not.toBe(0)
    expect(result.output).toContain("does not contain origin/master")
    expect(result.ghCalls).toBe("")
  })

  describe("#given pin-ci dispatched the pin's own CI run (#15094)", () => {
    test("#when the pin's push run was cancelled #then the gate waits on its own run and accepts it once green", () => {
      const result = dispatch({
        pin: fixture.sha.B,
        prepared: "",
        pushConclusion: "cancelled",
        ownedStates: ["in_progress:", "in_progress:", "completed:success"],
      })
      expect(result.status, result.output).toBe(0)
      expect(result.output).toContain(`CI workflow run 55 ran and passed required validation for ${fixture.sha.B}.`)
    })

    test("#when its own run already has a failed job #then the gate refuses now, naming the job", () => {
      const result = dispatch({
        pin: fixture.sha.B,
        prepared: "",
        pushConclusion: "cancelled",
        ownedStates: ["in_progress:"],
        ownedRedJob: "test (windows-latest, 2/2)",
      })
      expect(result.status).not.toBe(0)
      expect(result.output).toContain(
        `The release's own CI run 55 for ${fixture.sha.B} is still running but already failed: test (windows-latest, 2/2)=failure.`,
      )
    })

    test("#when its own run concludes red #then the gate refuses", () => {
      const result = dispatch({
        pin: fixture.sha.B,
        prepared: "",
        pushConclusion: "cancelled",
        ownedStates: ["completed:failure"],
      })
      expect(result.status).not.toBe(0)
      expect(result.output).toContain(`The release's own CI run 55 for ${fixture.sha.B} concluded failure.`)
    })

    test.each([
      ["on another release's ref", { ownedBranch: "release-ci/other-2-1" }],
      ["dispatched by someone else", { ownedActor: "maint" }],
      ["of another workflow", { ownedWorkflow: "99" }],
    ] as const)("#when the recorded run is %s #then it is no receipt", (_name, run) => {
      const result = dispatch({
        pin: fixture.sha.B,
        prepared: "",
        pushConclusion: "cancelled",
        ownedStates: ["completed:success"],
        ...run,
      })
      expect(result.status).not.toBe(0)
      expect(result.output).toContain(`CI run 55 is not a run this release dispatched for ${fixture.sha.B}`)
    })

    test("#when a green push run lacks the validation proof #then the gate judges its own run instead of refusing", () => {
      const result = dispatch({
        pin: fixture.sha.B,
        prepared: "",
        pinValidation: "skipped-job",
        ownedStates: ["in_progress:", "completed:success"],
      })
      expect(result.status, result.output).toBe(0)
      expect(result.output).toContain(`CI workflow run 55 ran and passed required validation for ${fixture.sha.B}.`)
    })

    test.each([
      ["accepted", {}],
      ["refused for a foreign branch", { ownedBranch: "release-ci/elsewhere" }],
      ["refused when the ref names no publish.yml attempt", { parentWorkflow: "99" }],
      ["refused when a person dispatched the child", { triggeringActor: "maint" }],
      ["refused for another workflow's run", { ownedWorkflow: "99" }],
      ["refused when the parent recorded no receipt", { parentReceipt: "" }],
      ["refused when the parent's receipt names another CI run", { parentReceipt: "release-ci-receipt-x-y-56" }],
      ["refused when the receipt cannot be read", { receiptApiDown: true }],
      ["refused when the parent run cannot be read", { parentApiDown: true }],
    ] as const)(
      "#when the tagged child is given the parent's own run and no push is green #then it is %s",
      (name, change) => {
        const result = dispatch({
          pin: fixture.sha.B,
          prepared: fixture.sha.T,
          pushConclusion: "cancelled",
          ownedInChild: true,
          ownedStates: ["completed:success"],
          triggeringActor: "github-actions[bot]",
          ...change,
        })
        if (name === "accepted") {
          expect(result.status, result.output).toBe(0)
          expect(result.output).toContain(`CI workflow run 55 ran and passed required validation for ${fixture.sha.B}.`)
        } else {
          expect(result.status).not.toBe(0)
          expect(result.output).not.toContain("ran and passed required validation")
        }
      },
    )
  })

  test("#when only non-push CI is green #then neither dispatch can proceed", () => {
    for (const prepared of ["", fixture.sha.T]) {
      const result = dispatch({ pin: fixture.sha.B, prepared, pushConclusion: "failure" })
      expect(result.ghCalls).toContain(`head_sha=${fixture.sha.B} -f event=push`)
      expect(result.status).not.toBe(0)
    }
  })

  test("#when the merged stamp is version-only #then only the pinned push run is needed", () => {
    const result = dispatch({ pin: fixture.sha.B.toUpperCase(), prepared: fixture.sha.T, ciConclusion: "failure" })
    expect(result.status, result.output).toBe(0)
    expect(result.ghCalls).toContain(`head_sha=${fixture.sha.B} -f event=push`)
    expect(result.ghCalls).not.toContain(`head_sha=${fixture.sha.T}`)
  })

  test("#when the delta changes workflow code #then green PR CI cannot substitute for push CI on the stamp", () => {
    for (const stampPushConclusion of ["success", "failure"]) {
      const result = dispatch({
        pin: fixture.sha.A,
        prepared: fixture.sha.B,
        ciConclusion: "success",
        stampPushConclusion,
      })
      expect(result.ghCalls).toContain(`head_sha=${fixture.sha.A} -f event=push`)
      expect(result.status === 0).toBe(stampPushConclusion === "success")
      expect(result.ghCalls).toContain(`head_sha=${fixture.sha.B} -f event=push`)
    }
  })

  test("#when the published SHA is a grandchild of the pin #then green CI cannot authorize it", () => {
    const result = dispatch({ pin: fixture.sha.A, prepared: fixture.sha.T })
    expect(result.status).not.toBe(0)
    expect(result.ghCalls).toBe("")
  })
})

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

  // #14438: a release-state run kept on Linux, or a release merge push that skipped macOS/Windows, proves them only
  // through its base; the same rule ci-fast-path.mjs used to keep it on Linux.
  test.each([
    ["its legs ran green", { runLegs: "success" }, 0, "Its macOS/Windows legs ran and passed."],
    [
      "its legs were skipped on a stamp over a base whose legs ran green",
      { runLegs: "skipped", prepared: "P", baseLegs: "success" },
      0,
      "the delta is the release stamp only",
    ],
    [
      "its legs were skipped and the base's legs were red",
      { runLegs: "skipped", prepared: "P", baseLegs: "failure" },
      1,
      "has no dev push run whose macOS/Windows legs ran green",
    ],
    [
      "its legs were skipped and the base's legs were skipped too",
      { runLegs: "skipped", prepared: "P", baseLegs: "skipped" },
      1,
      "has no dev push run whose macOS/Windows legs ran green",
    ],
    [
      "its legs were skipped on a stamp that also changes source",
      { runLegs: "skipped", prepared: "Q", baseLegs: "success" },
      1,
      "changes more than the release stamp",
    ],
    [
      "its legs were skipped on a stamp that renames a source file into the changelog fragments",
      { runLegs: "skipped", prepared: "S", baseLegs: "success" },
      1,
      "changes more than the release stamp",
    ],
  ] as const)(
    "#given an empty receipt and a successful hosted run #when %s #then gate-reuse decides on the platform proof",
    (_label, input, status, line) => {
      const prepared = "prepared" in input ? fixture.sha[input.prepared] : undefined
      const legs = { runLegs: input.runLegs, ...("baseLegs" in input ? { baseLegs: input.baseLegs } : {}) }
      const outcome = dispatch({ ...legs, ...(prepared === undefined ? {} : { prepared }) })
      expect(outcome.status === 0 ? 0 : 1).toBe(status)
      expect(outcome.output).toContain(line)
    },
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
