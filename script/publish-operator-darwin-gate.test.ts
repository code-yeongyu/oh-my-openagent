/// <reference types="bun-types" />

import { afterEach, describe, expect, test } from "bun:test"
import { spawnSync } from "node:child_process"
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { desktopEngineLegs } from "./release-workflow-test-steps"

/**
 * Release security contract (#13921): `operator_darwin_artifacts` replaces the hosted macOS legs only for an
 * admin/maintain actor AND triggering actor on the prepared-source run, with a well-formed staging tag; an
 * empty input leaves every hosted leg in place. The gate step is executed from the parsed publish.yml with
 * `gh` stubbed; the wiring is read from the parsed workflows.
 */

type Step = {
  name?: string
  run?: string
  if?: string
  uses?: string
  env?: Record<string, string>
  with?: Record<string, unknown>
  "continue-on-error"?: unknown
}
type Job = {
  "timeout-minutes"?: number
  if?: string
  needs?: string[]
  "runs-on"?: string
  steps?: Step[]
  with?: Record<string, string>
}
type Workflow = { on: { workflow_call?: { inputs: Record<string, unknown> } }; jobs: Record<string, Job> }

const load = (file: string): Workflow =>
  Bun.YAML.parse(
    readFileSync(new URL(`../.github/workflows/${file}`, import.meta.url), "utf8").replace(/\r\n/g, "\n"),
  ) as Workflow
const publish = load("publish.yml")
const platform = load("publish-platform.yml")
const job = (workflow: Workflow, name: string): Job => {
  const found = workflow.jobs[name]
  if (!found) throw new Error(`missing job ${name}`)
  return found
}
const stepRun = (workflow: Workflow, jobName: string, stepName: string): string => {
  const run = job(workflow, jobName).steps?.find((step) => step.name === stepName)?.run
  if (!run) throw new Error(`${jobName} has no runnable step ${stepName}`)
  return run
}

const PREPARED = "2222222222222222222222222222222222222222"
const TAG = "operator-darwin-111111111111"
const GH_STUB = [
  "gh() {",
  '  printf "%s\\n" "$*" >> "$GH_CALLS"',
  '  [ -n "$PERMISSION_API_DOWN" ] && return 1',
  '  local login="${2#*/collaborators/}"; login="${login%/permission}"',
  '  local entry; for entry in $ROLES; do [ "${entry%%=*}" = "$login" ] && { printf "%s\\n" "${entry#*=}"; return 0; }; done',
  '  printf "none\\n"',
  "}",
  "",
].join("\n")

const scratch: string[] = []
afterEach(() => {
  for (const dir of scratch.splice(0)) rmSync(dir, { recursive: true, force: true })
})

type Gate = {
  input?: string
  manifest?: string
  prepared?: string
  actor?: string
  triggeringActor?: string
  roles?: string
  apiDown?: boolean
}
const MANIFEST_SHA256 = "ab".repeat(32)

function gate(dispatch: Gate) {
  const root = mkdtempSync(join(tmpdir(), "operator-darwin-gate-"))
  scratch.push(root)
  const script = join(root, "step.sh")
  writeFileSync(
    script,
    GH_STUB +
      stepRun(publish, "gate-reuse", "Refuse inadmissible operator darwin artifacts").replaceAll(
        "${{ github.repository }}",
        "o/r",
      ),
  )
  const env = {
    PATH: process.env.PATH ?? "",
    GH_CALLS: join(root, "gh-calls"),
    GITHUB_STEP_SUMMARY: join(root, "summary.md"),
    OPERATOR_DARWIN_ARTIFACTS: dispatch.input ?? TAG,
    OPERATOR_DARWIN_MANIFEST_SHA256: dispatch.manifest ?? (dispatch.input === "" ? "" : MANIFEST_SHA256),
    PREPARED_RELEASE_SHA: dispatch.prepared ?? PREPARED,
    ACTOR: dispatch.actor ?? "maintainer",
    TRIGGERING_ACTOR: dispatch.triggeringActor ?? dispatch.actor ?? "maintainer",
    REPOSITORY: "o/r",
    ROLES: dispatch.roles ?? "maintainer=maintain owner=admin writer=write",
    PERMISSION_API_DOWN: dispatch.apiDown ? "1" : "",
  }
  const result = spawnSync("bash", [script], { env, encoding: "utf8" })
  const read = (file: string) => (existsSync(file) ? readFileSync(file, "utf8") : "")
  return {
    status: result.status,
    output: `${result.stdout}${result.stderr}`,
    summary: read(env.GITHUB_STEP_SUMMARY),
    ghCalls: read(env.GH_CALLS),
  }
}

describe("operator darwin gate (publish.yml gate-reuse)", () => {
  test("an empty input is admitted without any permission lookup or summary", () => {
    const outcome = gate({ input: "", prepared: "" })
    expect(outcome).toMatchObject({ status: 0, ghCalls: "", summary: "" })
  })

  test("a maintainer and an admin on the prepared-source run are admitted and named OPERATOR-BUILT", () => {
    for (const actor of ["maintainer", "owner"]) {
      const outcome = gate({ actor })
      expect(outcome.status).toBe(0)
      expect(outcome.summary).toContain("OPERATOR-BUILT")
      expect(outcome.summary).toContain(TAG)
      expect(outcome.summary).toContain(MANIFEST_SHA256)
      expect(outcome.summary).toContain(actor)
    }
  })

  const refusals: Array<[string, Gate, RegExp, boolean]> = [
    [
      "a manifest pin without the operator input",
      { input: "", manifest: MANIFEST_SHA256 },
      /operator_darwin_manifest_sha256 is set without operator_darwin_artifacts/,
      false,
    ],
    [
      "the operator input without a manifest pin",
      { manifest: "" },
      /operator_darwin_manifest_sha256 must be the 64 lowercase hex/,
      false,
    ],
    [
      "a malformed manifest pin",
      { manifest: MANIFEST_SHA256.toUpperCase() },
      /operator_darwin_manifest_sha256 must be the 64 lowercase hex/,
      false,
    ],
    ["an empty prepared_release_sha", { prepared: "" }, /prepared_release_sha is empty/, false],
    ["a short prepared_release_sha", { prepared: "2222222" }, /full 40-character/, false],
    ["an uppercase prepared_release_sha", { prepared: "ABCDEF".repeat(6) + "ABCD" }, /full 40-character/, false],
    ["a tag with uppercase hex", { input: "operator-darwin-11111111111A" }, /must be operator-darwin-/, false],
    ["a tag with a short sha", { input: "operator-darwin-1111" }, /must be operator-darwin-/, false],
    ["a foreign release tag", { input: "v5.1.73" }, /must be operator-darwin-/, false],
    ["a tag with a trailing newline payload", { input: `${TAG}\nmalicious` }, /must be operator-darwin-/, false],
    ["a write-role actor", { actor: "writer" }, /writer has repository role 'write'/, true],
    ["a non-collaborator", { actor: "stranger" }, /stranger has repository role 'none'/, true],
    [
      "a maintainer re-run triggered by a write-role user",
      { actor: "maintainer", triggeringActor: "writer" },
      /writer has repository role 'write'/,
      true,
    ],
    ["a bot actor", { actor: "github-actions[bot]" }, /is not a GitHub user login/, false],
    ["an unreadable permission", { apiDown: true }, /could not read the repository permission/, true],
  ]
  for (const [name, dispatch, reason, looksUp] of refusals) {
    test(`refuses ${name}`, () => {
      const outcome = gate(dispatch)
      expect(outcome.status).toBe(1)
      expect(outcome.output).toMatch(new RegExp(`::error::operator_darwin_artifacts refused: .*${reason.source}`))
      expect(outcome.summary).toBe("")
      expect(outcome.ghCalls !== "").toBe(looksUp)
    })
  }
})

describe("operator darwin wiring", () => {
  test("the parent preparation run never dispatches the child when the input is set", () => {
    expect(job(publish, "dispatch-provenance-safe-publish").if).toContain("inputs.operator_darwin_artifacts == ''")
    expect(job(publish, "dispatch-provenance-safe-publish").if).toContain(
      "inputs.operator_darwin_manifest_sha256 == ''",
    )
  })

  test("publish-platform receives the input and the prepared sha from the provenance run only", () => {
    expect(job(publish, "publish-platform").with).toMatchObject({
      operator_darwin_artifacts: "${{ inputs.operator_darwin_artifacts }}",
      operator_darwin_manifest_sha256: "${{ inputs.operator_darwin_manifest_sha256 }}",
      prepared_release_sha: "${{ inputs.prepared_release_sha }}",
    })
    expect(Object.keys(platform.on.workflow_call?.inputs ?? {})).toEqual(
      expect.arrayContaining(["operator_darwin_artifacts", "operator_darwin_manifest_sha256", "prepared_release_sha"]),
    )
  })

  test("the desktop-engine matrix keeps both darwin legs only when the input is empty", () => {
    const text = readFileSync(new URL("../.github/workflows/publish-platform.yml", import.meta.url), "utf8")
    expect(desktopEngineLegs(text).map((leg) => leg.host)).toEqual([
      "darwin-arm64",
      "darwin-x64",
      "linux-x64",
      "linux-arm64",
      "win32-x64",
      "win32-arm64",
    ])
    expect(desktopEngineLegs(text, TAG).map((leg) => leg.host)).toEqual([
      "linux-x64",
      "linux-arm64",
      "win32-x64",
      "win32-arm64",
    ])
  })

  test("the hosted keychain-helper runs only without the input, and operator-darwin only with it", () => {
    expect(job(platform, "keychain-helper").if).toContain("inputs.operator_darwin_artifacts == ''")
    expect(job(platform, "operator-darwin").if).toContain("inputs.operator_darwin_artifacts != ''")
    expect(job(platform, "operator-darwin")["runs-on"]).toBe("ubuntu-24.04")
    // LOW-3 (#13945 review): the job is capped well below the 6 h default; each lookup inside it is bounded too.
    expect(job(platform, "operator-darwin")["timeout-minutes"]).toBe(30)
  })

  test("build waits for the verified operator artifacts and leaves macOS only for the hosted mode", () => {
    const build = job(platform, "build")
    expect(build.needs).toEqual(expect.arrayContaining(["desktop-engine", "keychain-helper", "operator-darwin"]))
    expect(build.if).toContain("inputs.operator_darwin_artifacts != '' && needs.operator-darwin.result == 'success'")
    expect(build.if).toContain("inputs.operator_darwin_artifacts == '' && needs.keychain-helper.result == 'success'")
    expect(build["runs-on"]).toContain(
      "startsWith(matrix.platform, 'darwin-') && inputs.operator_darwin_artifacts == '' && 'macos-latest'",
    )
  })

  test("#13964 L2: the pinned-verifier guard runs before any operator-supplied input is downloaded or read", () => {
    const names = (job(platform, "operator-darwin").steps ?? []).map((step) => step.name ?? step.uses ?? "")
    const guard = names.indexOf("Refuse operator darwin verifier code that differs from the default branch")
    expect(guard).toBeGreaterThan(-1)
    expect(guard).toBeLessThan(names.indexOf("Download operator darwin artifacts"))
    expect(guard).toBeLessThan(names.indexOf("Verify operator darwin artifacts"))
  })

  test("no operator-darwin step can be skipped or soft-fail (only the job summary runs always)", () => {
    for (const step of job(platform, "operator-darwin").steps ?? []) {
      const allowed = step.name === "Write job summary" ? "always()" : undefined
      expect({ step: step.name, if: step.if, soft: step["continue-on-error"] }).toEqual({
        step: step.name,
        if: allowed,
        soft: undefined,
      })
    }
  })

  test("operator-darwin keeps its write token out of .git and re-checks the dispatcher in the verifier", () => {
    const steps = job(platform, "operator-darwin").steps ?? []
    expect(steps.find((step) => step.uses?.startsWith("actions/checkout"))?.with).toEqual({
      "persist-credentials": false,
    })
    const verify = steps.find((step) => step.name === "Verify operator darwin artifacts")
    expect(verify?.env).toMatchObject({
      MANIFEST_SHA256: "${{ inputs.operator_darwin_manifest_sha256 }}",
      ACTOR: "${{ github.actor }}",
      TRIGGERING_ACTOR: "${{ github.triggering_actor }}",
    })
    for (const flag of [
      '--manifest-sha256 "$MANIFEST_SHA256"',
      '--actor "$ACTOR"',
      '--triggering-actor "$TRIGGERING_ACTOR"',
    ])
      expect(verify?.run).toContain(flag)
  })

  test("a darwin build leg with the input takes its release binary from the operator artifacts", () => {
    const run = stepRun(platform, "build", "Check release assets").replaceAll("${{ matrix.platform }}", "darwin-x64")
    const root = mkdtempSync(join(tmpdir(), "operator-darwin-assets-"))
    scratch.push(root)
    const output = join(root, "output")
    const result = spawnSync(
      "bash",
      ["-c", `gh() { echo gh-called >&2; return 1; }\nbun() { echo bun-called >&2; return 1; }\n${run}`],
      {
        env: {
          PATH: process.env.PATH ?? "",
          GITHUB_OUTPUT: output,
          OMO_AI_VERSION: "5.1.73",
          VERSION: "5.1.73",
          OPERATOR_DARWIN_ARTIFACTS: TAG,
        },
        encoding: "utf8",
      },
    )
    expect(result.status).toBe(0)
    expect(readFileSync(output, "utf8")).toBe("binary_exists=true\n")
    expect(result.stderr).not.toContain("called")
  })
})
