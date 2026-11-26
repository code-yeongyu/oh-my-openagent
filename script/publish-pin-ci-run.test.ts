/// <reference types="bun-types" />

import { afterEach, describe, expect, test } from "bun:test"
import { spawnSync } from "node:child_process"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { CI_YML_PATH, YQ_TO_JSON } from "./fixtures/publish-ci-validation"

/**
 * Release contract (#15094): a pinned release owns the CI run its gate waits on. ci.yml keeps only the newest pending
 * push run per ref, so on dev a later merge can cancel the pin's push run before it starts. publish.yml's pin-ci job
 * puts the pin on its own ref, refs/heads/release-ci/<sha>, and dispatches ci.yml there; ci.yml's concurrency group is
 * keyed by that ref, so nothing else shares it. Executes the shipped step with `gh` stubbed and the real ci.yml.
 */

const STEP = "Dispatch CI on the pinned source's own ref"
const SHA = "0123456789abcdef0123456789abcdef01234567"
const REPO = "code-yeongyu/oh-my-openagent"

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

const GH_STUB = [
  "gh() {",
  '  printf "%s\\n" "$*" >> "$GH_CALLS"',
  '  local filter="" previous="" argument',
  '  for argument in "$@"; do [ "$previous" = --jq ] && filter="$argument"; previous="$argument"; done',
  '  case "$*" in',
  '    *"actions/workflows/ci.yml/runs"*) printf \'{"workflow_runs":[{"event":"%s","status":"completed","conclusion":"%s"}]}\' "$RUN_EVENT" "$RUN_CONCLUSION" | jq -r "$filter" ;;',
  '    *"/contents/.github/workflows/ci.yml?ref="*) cat "$CI_YML" ;;',
  '    "api --method POST "*"/git/refs "*) [ -z "$REF_EXISTS" ] ;;',
  '    *"/git/ref/heads/release-ci/"*) printf "%s\\n" "$REF_EXISTS" ;;',
  '    "workflow run "*) ;;',
  "    *) return 1 ;;",
  "  esac",
  "}",
  `yq() { [ "$1" = -o=json ] || return 1; ${YQ_TO_JSON}; }`,
  "",
].join("\n")

interface Run {
  readonly greenRun?: "push" | "workflow_dispatch"
  readonly ciYml?: string
  readonly refExistsAt?: string
}

interface Outcome {
  readonly status: number
  readonly output: string
  readonly ghCalls: string
  readonly pinned: string
}

const scratch: string[] = []
afterEach(() => {
  for (const dir of scratch.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function runStep(input: Run): Outcome {
  const root = mkdtempSync(join(tmpdir(), "publish-pin-ci-"))
  scratch.push(root)
  const run = publish.jobs["pin-ci"]?.steps.find((step) => step.name === STEP)?.run
  if (!run) throw new Error(`pin-ci has no runnable step named ${STEP}`)
  const script = join(root, "step.sh")
  writeFileSync(script, GH_STUB + run)
  const files = { ghCalls: join(root, "gh-calls"), output: join(root, "output"), ciYml: join(root, "ci.yml") }
  writeFileSync(files.ghCalls, "")
  writeFileSync(files.output, "")
  writeFileSync(files.ciYml, input.ciYml ?? readFileSync(CI_YML_PATH, "utf8"))
  const result = spawnSync("bash", ["-eo", "pipefail", script], {
    cwd: root,
    encoding: "utf8",
    env: {
      PATH: process.env.PATH ?? "",
      BUN_EXE: process.execPath,
      GH_CALLS: files.ghCalls,
      GITHUB_OUTPUT: files.output,
      GITHUB_STEP_SUMMARY: join(root, "summary"),
      GH_REPO: REPO,
      SOURCE_SHA: SHA,
      RUN_EVENT: input.greenRun ?? "push",
      RUN_CONCLUSION: input.greenRun ? "success" : "cancelled",
      REF_EXISTS: input.refExistsAt ?? "",
      CI_YML: files.ciYml,
    },
  })
  if (result.error) throw result.error
  const pinned = /pinned=(\w+)\s*$/.exec(readFileSync(files.output, "utf8"))?.[1] ?? ""
  return {
    status: result.status ?? -1,
    output: `${result.stdout}${result.stderr}`,
    ghCalls: readFileSync(files.ghCalls, "utf8"),
    pinned,
  }
}

describe("publish.yml pin-ci (#15094)", () => {
  test("#given ci.yml #then its concurrency group is keyed by the ref and it accepts a dispatch", () => {
    expect(ci.concurrency?.group).toContain("github.ref")
    expect(Object.keys(ci.on)).toContain("workflow_dispatch")
  })

  test("#given a pinned parent run #then gate-reuse waits for pin-ci, and unpin-ci always removes the ref", () => {
    expect(publish.jobs["pin-ci"]?.if).toContain("inputs.source_sha != ''")
    expect(publish.jobs["gate-reuse"]?.needs).toContain("pin-ci")
    expect(publish.jobs["unpin-ci"]?.needs).toEqual(expect.arrayContaining(["pin-ci", "gate-reuse"]))
    expect(publish.jobs["unpin-ci"]?.if).toContain("always()")
  })

  test("#when the pin has no green run #then it puts the pin on release-ci/<sha> and dispatches CI there", () => {
    const result = runStep({})
    expect(result.status, result.output).toBe(0)
    expect(result.pinned).toBe("true")
    expect(result.ghCalls).toContain(`repos/${REPO}/git/refs -f ref=refs/heads/release-ci/${SHA} -f sha=${SHA}`)
    expect(result.ghCalls).toContain(`workflow run ci.yml --ref release-ci/${SHA}`)
  })

  test.each(["push", "workflow_dispatch"] as const)(
    "#when a green %s run already exists for the pin #then nothing is created or dispatched",
    (greenRun) => {
      const result = runStep({ greenRun })
      expect(result.status, result.output).toBe(0)
      expect(result.pinned).toBe("false")
      expect(result.ghCalls).not.toContain("workflow run")
      expect(result.ghCalls).not.toContain("--method POST")
    },
  )

  test("#when ci.yml at the pin predates the dispatch trigger #then the gate falls back to the dev push run", () => {
    const oldCi = readFileSync(CI_YML_PATH, "utf8").replace(/^ {2}workflow_dispatch:\n/m, "")
    const result = runStep({ ciYml: oldCi })
    expect(result.status, result.output).toBe(0)
    expect(result.pinned).toBe("false")
    expect(result.ghCalls).not.toContain("workflow run")
  })

  test("#when release-ci/<sha> already names another commit #then it refuses rather than test the wrong code", () => {
    const result = runStep({ refExistsAt: "fedcba9876543210fedcba9876543210fedcba98" })
    expect(result.status).not.toBe(0)
    expect(result.ghCalls).not.toContain("workflow run")
  })

  test("#when release-ci/<sha> already names the pin (a rerun) #then it dispatches on it", () => {
    const result = runStep({ refExistsAt: SHA })
    expect(result.status, result.output).toBe(0)
    expect(result.ghCalls).toContain(`workflow run ci.yml --ref release-ci/${SHA}`)
  })
})
