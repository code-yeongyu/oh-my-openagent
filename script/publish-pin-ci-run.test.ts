/// <reference types="bun-types" />

import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test"
import { spawnSync } from "node:child_process"
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { CI_YML_PATH, YQ_TO_JSON } from "./fixtures/publish-ci-validation"
import { createGitOrigin, type GitOrigin } from "./fixtures/publish-gate-reuse-origin"

/**
 * Release contract (#15094): a pinned release owns the CI run its gate waits on. ci.yml keeps only the newest pending
 * push run per ref, so on dev a later merge can cancel the pin's push run before it starts. publish.yml's pin-ci job
 * admits the source first (read-only), then puts it on this attempt's own ref, release-ci/<sha>-<run id>-<attempt>,
 * dispatches ci.yml there and records the run id the dispatch returned; unpin-ci cancels and removes them on every outcome. Executes the shipped steps against a
 * real git origin with `gh` stubbed.
 */

const PIN_STEP = "Dispatch CI on the pinned source's own ref"
const UNPIN_STEP = "Delete the pinned source's CI ref"
const REPO = "code-yeongyu/oh-my-openagent"
const TEST_TIMEOUT_MS = process.platform === "win32" ? 60_000 : 20_000

interface Workflow {
  readonly on: Record<string, unknown>
  readonly concurrency?: { readonly group?: string }
  readonly jobs: Record<
    string,
    { readonly needs?: readonly string[]; readonly if?: string; readonly steps: Array<{ name?: string; run?: string }> }
  >
}

function parse(path: URL | string): Workflow {
  return Bun.YAML.parse(readFileSync(path, "utf8").replace(/\r\n/g, "\n")) as Workflow
}

const publish = parse(new URL("../.github/workflows/publish.yml", import.meta.url))
const ci = parse(CI_YML_PATH)

function stepRun(job: string, name: string): string {
  const run = publish.jobs[job]?.steps.find((step) => step.name === name)?.run
  if (!run) throw new Error(`${job} has no runnable step named ${name}`)
  return run
}

// REF_POST: "lost" creates the ref but answers with an error, "fails" creates nothing. REF_READ: "error" answers HTTP 502.
// DISPATCH: "no-id" answers without a run id; the ref then has one unknown queued run, 78. RUN_LIST: "error" fails listing it, "never" never lists it; RUN_VISIBLE_AFTER: lists before it shows up. RUN_READ / CANCEL: "error" fails that call. RUN_STATUS: the run's status.
const GH_STUB = [
  "gh() {",
  '  printf "%s\\n" "$*" >> "$GH_CALLS"',
  '  local filter="" previous="" argument',
  '  for argument in "$@"; do [ "$previous" = --jq ] && filter="$argument"; previous="$argument"; done',
  '  case "$*" in',
  '    *"/contents/.github/workflows/ci.yml?ref="*) cat "$CI_YML" ;;',
  '    "api --method POST "*"/git/refs "*) [ "${REF_POST:-}" = fails ] && return 1; printf "%s" "$SOURCE_SHA_LOWER" > "$STATE/ref"; [ "${REF_POST:-}" != lost ] ;;',
  '    *"/git/ref/heads/release-ci/"*) [ "${REF_READ:-}" = error ] && { echo "gh: Server Error (HTTP 502)"; return 1; }; { [ -f "$STATE/ref" ] && [ ! -f "$STATE/deleted" ]; } || { echo "gh: Not Found (HTTP 404)"; return 1; }; printf \'{"object":{"sha":"%s"}}\' "$(cat "$STATE/ref")" | jq -r "$filter" ;;',
  '    "api --method DELETE "*) touch "$STATE/deleted" ;;',
  '    *"/actions/workflows/ci.yml/dispatches "*) if [ "${DISPATCH:-}" = no-id ]; then echo "{}"; else echo \'{"workflow_run_id":77}\'; fi | jq -r "$filter" ;;',
  '    *"/actions/runs/77 "*) [ "${RUN_READ:-}" = error ] && return 1; printf \'{"status":"%s"}\' "$RUN_STATUS" | jq -r "$filter" ;;',
  '    *"actions/workflows/ci.yml/runs"*) [ "${RUN_LIST:-}" = error ] && return 1; local n=0; [ -f "$STATE/lists" ] && n=$(cat "$STATE/lists"); printf "%s" $((n + 1)) > "$STATE/lists"; if [ "${RUN_LIST:-}" = never ] || [ "$n" -lt "${RUN_VISIBLE_AFTER:-0}" ]; then echo \'{"workflow_runs":[]}\'; else echo \'{"workflow_runs":[{"id":78,"status":"queued"}]}\'; fi | jq -r "$filter" ;;',
  '    "run cancel 78"*) touch "$STATE/cancelled-stray" ;;',
  '    "run cancel 77"*) [ "${CANCEL:-}" = error ] && return 1; touch "$STATE/cancelled" ;;',
  "    *) return 1 ;;",
  "  esac",
  "}",
  "sleep() { :; }",
  `yq() { [ "$1" = -o=json ] || return 1; ${YQ_TO_JSON}; }`,
  "",
].join("\n")

const fixtureRoot = mkdtempSync(join(tmpdir(), "publish-pin-ci-origin-"))
let fixture: GitOrigin
beforeAll(() => {
  fixture = createGitOrigin(fixtureRoot)
}, 4 * TEST_TIMEOUT_MS)
afterAll(() => rmSync(fixtureRoot, { recursive: true, force: true }))

const scratch: string[] = []
afterEach(() => {
  for (const dir of scratch.splice(0)) rmSync(dir, { recursive: true, force: true })
})

interface Pin {
  readonly pin: string
  readonly ciYml?: string
  readonly refPost?: "lost" | "fails"
  readonly dispatch?: "no-id"
  readonly refRead?: "error"
}

interface Cleanup {
  readonly runStatus: string
  readonly runRead?: "error"
  readonly cancel?: "error"
  readonly refRead?: "error"
  readonly runList?: "error" | "never"
  readonly runVisibleAfter?: number
}

interface Outcome {
  readonly status: number
  readonly output: string
  readonly ghCalls: string
  readonly outputs: Record<string, string>
  readonly root: string
}

function run(script: string, root: string, env: Record<string, string>): { status: number; output: string } {
  const path = join(root, `${Object.keys(env).length}-${Math.random().toString(36).slice(2)}.sh`)
  writeFileSync(path, GH_STUB + script)
  const result = spawnSync("bash", ["-eo", "pipefail", path], {
    cwd: join(root, "checkout"),
    encoding: "utf8",
    timeout: TEST_TIMEOUT_MS - 1_000,
    env: {
      ...fixture.gitEnv,
      BUN_EXE: process.execPath,
      GH_REPO: REPO,
      STATE: root,
      GH_CALLS: join(root, "gh-calls"),
      ...env,
    },
  })
  if (result.error) throw result.error
  return { status: result.status ?? -1, output: `${result.stdout}${result.stderr}` }
}

function pinCi(input: Pin): Outcome {
  const root = mkdtempSync(join(tmpdir(), "publish-pin-ci-"))
  scratch.push(root)
  const checkout = join(root, "checkout")
  fixture.initCheckout(checkout)
  const git = (args: string[]) => {
    const result = spawnSync("git", args, { cwd: checkout, env: fixture.gitEnv, encoding: "utf8" })
    if (result.status !== 0) throw new Error(result.stderr)
  }
  git(["fetch", "origin"])
  git(["update-ref", "refs/remotes/origin/master", fixture.sha.A])
  git(["checkout", "--detach", "origin/dev"])
  const admission = ".github/scripts/release-source-admission.sh"
  mkdirSync(join(checkout, dirname(admission)), { recursive: true })
  copyFileSync(new URL(`../${admission}`, import.meta.url), join(checkout, admission))
  const output = join(root, "output")
  writeFileSync(output, "")
  writeFileSync(join(root, "gh-calls"), "")
  writeFileSync(join(root, "ci.yml"), input.ciYml ?? readFileSync(CI_YML_PATH, "utf8"))
  const result = run(stepRun("pin-ci", PIN_STEP), root, {
    GITHUB_OUTPUT: output,
    GITHUB_STEP_SUMMARY: join(root, "summary"),
    GITHUB_SHA: fixture.sha.T,
    SOURCE_SHA: input.pin,
    SOURCE_SHA_LOWER: input.pin.toLowerCase(),
    LAZYCODEX_ONLY: "false",
    CI_BASIS_RECEIPT: "",
    PREPARED_RELEASE_SHA: "",
    CI_YML: join(root, "ci.yml"),
    GITHUB_RUN_ID: "900",
    GITHUB_RUN_ATTEMPT: "1",
    REF_POST: input.refPost ?? "",
    DISPATCH: input.dispatch ?? "",
    REF_READ: input.refRead ?? "",
  })
  const outputs = Object.fromEntries(
    readFileSync(output, "utf8")
      .split("\n")
      .filter((line) => line.includes("="))
      .map((line) => [line.slice(0, line.indexOf("=")), line.slice(line.indexOf("=") + 1)]),
  )
  return { ...result, ghCalls: readFileSync(join(root, "gh-calls"), "utf8"), outputs, root }
}

function unpinCi(after: Outcome, input: Cleanup) {
  writeFileSync(join(after.root, "gh-calls"), "")
  const result = run(stepRun("unpin-ci", UNPIN_STEP), after.root, {
    SOURCE_SHA: after.outputs.source_sha ?? "",
    SOURCE_SHA_LOWER: after.outputs.source_sha ?? "",
    CI_RUN_ID: after.outputs.ci_run_id ?? "",
    CI_REF: after.outputs.ci_ref ?? "",
    RUN_STATUS: input.runStatus,
    RUN_READ: input.runRead ?? "",
    CANCEL: input.cancel ?? "",
    REF_READ: input.refRead ?? "",
    RUN_LIST: input.runList ?? "",
    RUN_VISIBLE_AFTER: String(input.runVisibleAfter ?? 0),
    DISPATCH_ATTEMPTED: after.outputs.dispatch_attempted ?? "",
  })
  const exists = (name: string) => spawnSync("test", ["-e", join(after.root, name)]).status === 0
  return {
    ...result,
    deleted: exists("deleted"),
    cancelled: exists("cancelled"),
    cancelledStray: exists("cancelled-stray"),
  }
}

describe("publish.yml pin-ci (#15094)", () => {
  test("#given ci.yml #then its concurrency group is keyed by the ref and it accepts a dispatch", () => {
    expect(ci.concurrency?.group).toContain("github.ref")
    expect(Object.keys(ci.on)).toContain("workflow_dispatch")
  })

  test("#given a pinned parent run #then gate-reuse judges pin-ci's run and unpin-ci runs on every outcome", () => {
    expect(publish.jobs["gate-reuse"]?.needs).toContain("pin-ci")
    expect(publish.jobs["unpin-ci"]?.needs).toEqual(expect.arrayContaining(["pin-ci", "gate-reuse"]))
    expect(publish.jobs["unpin-ci"]?.if).toContain("always()")
    expect(publish.jobs["unpin-ci"]?.if).toContain("needs.pin-ci.outputs.ref_owned == 'true'")
  })

  test("#when the pin is admitted #then this attempt's own ref is created, CI is dispatched there and the returned run recorded", () => {
    const result = pinCi({ pin: fixture.sha.B })
    const ref = `release-ci/${fixture.sha.B}-900-1`
    expect(result.status, result.output).toBe(0)
    expect(result.outputs).toEqual({
      source_sha: fixture.sha.B,
      ci_ref: ref,
      ref_owned: "true",
      dispatch_attempted: "true",
      ci_run_id: "77",
    })
    expect(result.ghCalls).toContain(`repos/${REPO}/git/refs -f ref=refs/heads/${ref} -f sha=${fixture.sha.B}`)
    expect(result.ghCalls).toContain(`actions/workflows/ci.yml/dispatches -f ref=${ref} -F return_run_details=true`)
  })

  test("#when the pin is given in uppercase #then the ref, dispatch and outputs use the canonical SHA", () => {
    const result = pinCi({ pin: fixture.sha.B.toUpperCase() })
    expect(result.status, result.output).toBe(0)
    expect(result.outputs.source_sha).toBe(fixture.sha.B)
    expect(result.ghCalls).toContain(`-f ref=release-ci/${fixture.sha.B}-900-1 `)
  })

  test("#when the pin is not on dev #then nothing is written or dispatched", () => {
    const result = pinCi({ pin: fixture.sha.D })
    expect(result.status).not.toBe(0)
    expect(result.output).toContain("is not on dev")
    expect(result.ghCalls).toBe("")
  })

  test("#when ci.yml at the pin predates the dispatch trigger #then the gate falls back to the dev push run", () => {
    const oldCi = readFileSync(CI_YML_PATH, "utf8").replace(/^ {2}workflow_dispatch:\n/m, "")
    const result = pinCi({ pin: fixture.sha.B, ciYml: oldCi })
    expect(result.status, result.output).toBe(0)
    expect(result.outputs.ref_owned).toBeUndefined()
    expect(result.ghCalls).not.toContain("--method POST")
  })

  test("#when creating the ref answers an error but created it #then the ref is owned and the release continues", () => {
    const result = pinCi({ pin: fixture.sha.B, refPost: "lost" })
    expect(result.status, result.output).toBe(0)
    expect(result.outputs.ref_owned).toBe("true")
  })

  test("#when creating the ref fails #then it dispatches nothing, and unpin-ci finds no ref and succeeds", () => {
    const result = pinCi({ pin: fixture.sha.B, refPost: "fails" })
    expect(result.status).not.toBe(0)
    expect(result.outputs.ref_owned).toBe("true")
    expect(result.ghCalls).not.toContain("dispatches")
    const cleanup = unpinCi(result, { runStatus: "completed" })
    expect(cleanup.status, cleanup.output).toBe(0)
    expect(cleanup.output).toContain("is already gone")
  })

  test("#when the create's answer and its read-back both fail #then unpin-ci still reconciles the ref or fails unresolved", () => {
    const uncertain = () => pinCi({ pin: fixture.sha.B, refPost: "lost", refRead: "error" })
    const first = uncertain()
    expect(first.status).not.toBe(0)
    expect(first.outputs.ref_owned).toBe("true")
    const cleaned = unpinCi(first, { runStatus: "completed" })
    expect(cleaned.status, cleaned.output).toBe(0)
    expect(cleaned.deleted).toBe(true)
    const stuck = unpinCi(uncertain(), { runStatus: "completed", refRead: "error" })
    expect(stuck.status).not.toBe(0)
    expect(stuck.output).toContain("read-ref")
  })

  test("#when the dispatch answers no run id #then it fails without a second dispatch, and unpin-ci removes the ref", () => {
    const result = pinCi({ pin: fixture.sha.B, dispatch: "no-id" })
    expect(result.status).not.toBe(0)
    expect(result.outputs.ref_owned).toBe("true")
    expect(result.outputs.ci_run_id).toBeUndefined()
    expect(result.ghCalls.split("\n").filter((call) => call.includes("dispatches"))).toHaveLength(1)
    const cleanup = unpinCi(result, { runStatus: "completed" })
    expect(cleanup.status, cleanup.output).toBe(0)
    expect(cleanup.deleted).toBe(true)
    expect(cleanup.cancelledStray).toBe(true)
    const unlisted = unpinCi(pinCi({ pin: fixture.sha.B, dispatch: "no-id" }), {
      runStatus: "completed",
      runList: "error",
    })
    expect(unlisted.status).not.toBe(0)
    expect(unlisted.deleted).toBe(true)
    expect(unlisted.output).toContain("list-runs")
  })

  test("#when the run of a lost dispatch is listed only after a while #then unpin-ci keeps looking and cancels it", () => {
    const cleanup = unpinCi(pinCi({ pin: fixture.sha.B, dispatch: "no-id" }), {
      runStatus: "completed",
      runVisibleAfter: 3,
    })
    expect(cleanup.status, cleanup.output).toBe(0)
    expect(cleanup.cancelledStray).toBe(true)
  })

  test("#when the run of a lost dispatch never shows up #then unpin-ci removes the ref but reports the dispatch indeterminate", () => {
    const cleanup = unpinCi(pinCi({ pin: fixture.sha.B, dispatch: "no-id" }), {
      runStatus: "completed",
      runList: "never",
    })
    expect(cleanup.status).not.toBe(0)
    expect(cleanup.deleted).toBe(true)
    expect(cleanup.output).toContain("dispatch-indeterminate")
  })

  test("#when the gate is done while the release's own run still runs #then unpin-ci cancels it and removes the ref", () => {
    const cleanup = unpinCi(pinCi({ pin: fixture.sha.B }), { runStatus: "in_progress" })
    expect(cleanup.status, cleanup.output).toBe(0)
    expect(cleanup.cancelled).toBe(true)
    expect(cleanup.deleted).toBe(true)
  })

  test.each([
    ["the run cannot be read", { runRead: "error" }],
    ["the run cannot be cancelled", { cancel: "error" }],
  ] as const)(
    "#when %s #then unpin-ci still removes the ref but fails, naming what is unresolved",
    (_name, failure) => {
      const cleanup = unpinCi(pinCi({ pin: fixture.sha.B }), { runStatus: "in_progress", ...failure })
      expect(cleanup.status).not.toBe(0)
      expect(cleanup.deleted).toBe(true)
      expect(cleanup.output).toContain("is unresolved")
    },
  )

  test("#when reading the ref fails with a server error #then unpin-ci does not call it gone and fails", () => {
    const cleanup = unpinCi(pinCi({ pin: fixture.sha.B }), { runStatus: "completed", refRead: "error" })
    expect(cleanup.status).not.toBe(0)
    expect(cleanup.deleted).toBe(false)
    expect(cleanup.output).not.toContain("is already gone")
    expect(cleanup.output).toContain("read-ref")
  })

  test("#when the ref is already gone #then unpin-ci succeeds without deleting anything", () => {
    const result = pinCi({ pin: fixture.sha.B })
    writeFileSync(join(result.root, "deleted"), "")
    const cleanup = unpinCi(result, { runStatus: "completed" })
    expect(cleanup.status, cleanup.output).toBe(0)
    expect(cleanup.output).toContain("is already gone")
  })

  test("#when the ref was moved to another commit #then unpin-ci leaves it and fails loudly", () => {
    const result = pinCi({ pin: fixture.sha.B })
    writeFileSync(join(result.root, "ref"), fixture.sha.C)
    const cleanup = unpinCi(result, { runStatus: "completed" })
    expect(cleanup.status).not.toBe(0)
    expect(cleanup.deleted).toBe(false)
    expect(cleanup.output).toContain("leaving it for a maintainer")
  })
})
