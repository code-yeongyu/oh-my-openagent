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
 * admits the source first (read-only), then puts it on its own ref, refs/heads/release-ci/<sha>, dispatches ci.yml
 * there and records the run it got; unpin-ci removes the ref on every outcome. Executes the shipped steps against a
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

// REF_AT: where refs/heads/release-ci/<sha> points ("" = absent). RUN_SEEN_AFTER: the runs listing shows run 77 only
// from this read on. RUN_STATUS: what the run read in unpin-ci answers.
const GH_STUB = [
  "gh() {",
  '  printf "%s\\n" "$*" >> "$GH_CALLS"',
  '  local filter="" previous="" argument',
  '  for argument in "$@"; do [ "$previous" = --jq ] && filter="$argument"; previous="$argument"; done',
  '  case "$*" in',
  '    *"/contents/.github/workflows/ci.yml?ref="*) cat "$CI_YML" ;;',
  '    "api --method POST "*"/git/refs "*) [ -z "$REF_AT" ] && { printf "%s" "$SOURCE_SHA_LOWER" > "$STATE/ref"; return 0; }; return 1 ;;',
  '    *"/git/ref/heads/release-ci/"*) local at="$REF_AT"; [ -f "$STATE/ref" ] && at=$(cat "$STATE/ref"); [ -f "$STATE/deleted" ] && at=""; [ -n "$at" ] || return 1; printf \'{"object":{"sha":"%s"}}\' "$at" | jq -r "$filter" ;;',
  '    "api --method DELETE "*) touch "$STATE/deleted" ;;',
  '    "workflow run "*) [ -z "$DISPATCH_FAILS" ] ;;',
  '    *"actions/workflows/ci.yml/runs"*)',
  '      local n=0; [ -f "$STATE/reads" ] && n=$(cat "$STATE/reads"); printf "%s" $((n + 1)) > "$STATE/reads"',
  '      if [ "$n" -ge "${RUN_SEEN_AFTER:-0}" ]; then printf \'{"workflow_runs":[{"id":77,"head_sha":"%s","created_at":"2999-01-01T00:00:00Z"}]}\' "$SOURCE_SHA_LOWER"; else printf \'{"workflow_runs":[]}\'; fi ;;',
  '    *"/actions/runs/77 "*) printf \'{"status":"%s"}\' "$RUN_STATUS" | jq -r "$filter" ;;',
  '    "run cancel 77"*) touch "$STATE/cancelled" ;;',
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
  readonly refAt?: string
  readonly runSeenAfter?: number
  readonly dispatchFails?: boolean
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
    REF_AT: input.refAt ?? "",
    RUN_SEEN_AFTER: String(input.runSeenAfter ?? 0),
    DISPATCH_FAILS: input.dispatchFails ? "1" : "",
  })
  const outputs = Object.fromEntries(
    readFileSync(output, "utf8")
      .split("\n")
      .filter((line) => line.includes("="))
      .map((line) => [line.slice(0, line.indexOf("=")), line.slice(line.indexOf("=") + 1)]),
  )
  return { ...result, ghCalls: readFileSync(join(root, "gh-calls"), "utf8"), outputs, root }
}

function unpinCi(
  after: Outcome,
  runStatus: string,
): { status: number; output: string; deleted: boolean; cancelled: boolean } {
  writeFileSync(join(after.root, "gh-calls"), "")
  const result = run(stepRun("unpin-ci", UNPIN_STEP), after.root, {
    SOURCE_SHA: after.outputs.source_sha ?? "",
    SOURCE_SHA_LOWER: after.outputs.source_sha ?? "",
    CI_RUN_ID: after.outputs.ci_run_id ?? "",
    REF_AT: "",
    RUN_STATUS: runStatus,
  })
  const exists = (name: string) => spawnSync("test", ["-e", join(after.root, name)]).status === 0
  return { ...result, deleted: exists("deleted"), cancelled: exists("cancelled") }
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

  test("#when the pin is admitted #then it is put on release-ci/<sha>, CI is dispatched there and the run is recorded", () => {
    const result = pinCi({ pin: fixture.sha.B, runSeenAfter: 2 })
    expect(result.status, result.output).toBe(0)
    expect(result.outputs).toEqual({ source_sha: fixture.sha.B, ref_owned: "true", ci_run_id: "77" })
    expect(result.ghCalls).toContain(
      `repos/${REPO}/git/refs -f ref=refs/heads/release-ci/${fixture.sha.B} -f sha=${fixture.sha.B}`,
    )
    expect(result.ghCalls).toContain(`workflow run ci.yml --ref release-ci/${fixture.sha.B}`)
  })

  test("#when the pin is given in uppercase #then the ref, dispatch and outputs use the canonical SHA", () => {
    const result = pinCi({ pin: fixture.sha.B.toUpperCase() })
    expect(result.status, result.output).toBe(0)
    expect(result.outputs.source_sha).toBe(fixture.sha.B)
    expect(result.ghCalls).toContain(`--ref release-ci/${fixture.sha.B}`)
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
    expect(result.ghCalls).not.toContain("workflow run")
  })

  test("#when release-ci/<sha> already names another commit #then it refuses and owns nothing", () => {
    const result = pinCi({ pin: fixture.sha.B, refAt: fixture.sha.C })
    expect(result.status).not.toBe(0)
    expect(result.outputs.ref_owned).toBeUndefined()
    expect(result.ghCalls).not.toContain("workflow run")
  })

  test("#when the dispatch fails after the ref was created #then the ref is still owned, and unpin-ci removes it", () => {
    const result = pinCi({ pin: fixture.sha.B, dispatchFails: true })
    expect(result.status).not.toBe(0)
    expect(result.outputs.ref_owned).toBe("true")
    const cleanup = unpinCi(result, "completed")
    expect(cleanup.status, cleanup.output).toBe(0)
    expect(cleanup.deleted).toBe(true)
  })

  test("#when the gate is done while the release's own run still runs #then unpin-ci cancels it and removes the ref", () => {
    const result = pinCi({ pin: fixture.sha.B })
    const cleanup = unpinCi(result, "in_progress")
    expect(cleanup.status, cleanup.output).toBe(0)
    expect(cleanup.cancelled).toBe(true)
    expect(cleanup.deleted).toBe(true)
  })

  test("#when the ref is already gone #then unpin-ci succeeds without deleting anything", () => {
    const result = pinCi({ pin: fixture.sha.B })
    writeFileSync(join(result.root, "deleted"), "")
    const cleanup = unpinCi(result, "completed")
    expect(cleanup.status, cleanup.output).toBe(0)
    expect(cleanup.output).toContain("is already gone")
  })

  test("#when the ref was moved to another commit #then unpin-ci leaves it and fails loudly", () => {
    const result = pinCi({ pin: fixture.sha.B })
    writeFileSync(join(result.root, "ref"), fixture.sha.C)
    const cleanup = unpinCi(result, "completed")
    expect(cleanup.status).not.toBe(0)
    expect(cleanup.deleted).toBe(false)
    expect(cleanup.output).toContain("leaving it for a maintainer")
  })
})
