/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test"
import { spawnSync } from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { resolveReleaseVersion } from "./release-version.mjs"

const workflowPath = new URL("../.github/workflows/publish.yml", import.meta.url)
// Windows checks YAML out with CRLF, and the byte-pinned markers below are written with LF, so
// the text is normalized once instead of every marker carrying both spellings.
const workflowText = readFileSync(workflowPath, "utf8").replace(/\r\n/g, "\n")
const workflow = Bun.YAML.parse(workflowText) as Workflow

interface Step {
  name?: string
  id?: string
  uses?: string
  if?: string
  env?: Record<string, unknown>
  run?: string
  "working-directory"?: string
}

interface Job {
  needs?: string[]
  if?: string
  uses?: string
  with?: Record<string, unknown>
  outputs?: Record<string, unknown>
  steps?: Step[]
}

interface Workflow {
  concurrency?: string | { group?: string; "cancel-in-progress"?: boolean }
  jobs?: Record<string, Job>
}

function job(name: string): Job {
  const value = workflow.jobs?.[name]
  if (!value) throw new Error(`missing job: ${name}`)
  return value
}

function steps(jobName: string): Step[] {
  return job(jobName).steps ?? []
}

function namedStep(jobName: string, name: string): Step {
  const value = steps(jobName).find((step) => step.name === name)
  if (!value) throw new Error(`missing step: ${jobName}/${name}`)
  return value
}

function mapOmoAiVersion(rootVersion: string): string {
  const prereleaseIndex = rootVersion.indexOf("-")
  return prereleaseIndex === -1
    ? rootVersion
    : `${rootVersion.slice(0, prereleaseIndex)}-0.${rootVersion.slice(prereleaseIndex + 1)}`
}

describe("omo-ai publish workflow shape", () => {
  test("requires tarball readiness before live install", () => {
    const readinessRun = namedStep("post-publish-verify", "Wait for omo-ai registry readiness").run ?? ""
    expect(readinessRun).toContain('npm view --prefer-online "omo-ai@$OMO_AI_VERSION" dist.tarball')
    expect(readinessRun).toContain(
      'curl --fail --silent --location --connect-timeout 10 --max-time 15 --head --output /dev/null "$TARBALL_URL"',
    )
  })

  test("preserves an explicit prerelease version and derives its beta dist tag", () => {
    // given
    const versionRun = namedStep("release-metadata", "Calculate version").run ?? ""

    // when
    const explicitVersionPrecedesBump =
      versionRun.indexOf('VERSION="$RAW_VERSION"') < versionRun.indexOf('if [ -z "$VERSION" ]')

    // then
    expect(explicitVersionPrecedesBump).toBe(true)
    expect(versionRun).toContain('METADATA=$(node script/release-version.mjs "$VERSION")')
    expect(resolveReleaseVersion("5.0.0-beta.62", false)).toEqual({ version: "5.0.0-beta.62", distTag: "beta" })
  })

  test("keeps trusted publishing unconditional and delegates validated channel metadata", () => {
    const preflightRun = namedStep("preflight-trust", "Verify trusted publisher for release packages").run ?? ""

    expect(preflightRun).toContain("ALL_PACKAGES=(oh-my-opencode oh-my-openagent omo-ai)")
    expect(preflightRun).toContain("docs/reference/omo-ai-publishing.md")
    expect(preflightRun).toContain('node script/preflight-trust.mjs "${ALL_PACKAGES[@]}"')
    const versionRun = namedStep("release-metadata", "Calculate version").run ?? ""
    expect(versionRun).toContain("DIST_TAG=$(printf '%s\\n' \"$METADATA\" | awk -F= '$1 == \"dist_tag\" { print $2 }')")
    expect(resolveReleaseVersion("5.0.0", false).distTag).toBe("")
    expect(resolveReleaseVersion("5.0.0-rc.1", false).distTag).toBe("rc")
  })
})

const repoRoot = fileURLToPath(new URL("../", import.meta.url))
const actionsExpression = (inner: string): string => `\${{ ${inner} }}`

// Runs a workflow step's real script with `npm` stubbed: `npm view` answers from LATEST/BETA (VIEW_FAIL=1 fails the
// dist-tags lookup, ADD_FAIL=1 fails `npm dist-tag add`), `sleep` returns at once, and every npm call is recorded.
// A successful `npm dist-tag add` records the moved beta; `dist-tags.beta` reads keep answering the old BETA for the
// first BETA_LAG reads (registry lag), then the moved version, else BETA_SETTLED, else BETA.
// RUNNER_TEMP is its own directory, so `runnerTemp` lists exactly what the step left behind there.
function runStep(
  run: string,
  env: Record<string, string>,
): {
  status: number | null
  stderr: string
  stdout: string
  calls: string[]
  runnerTemp: { name: string; content: string }[]
} {
  const dir = mkdtempSync(join(tmpdir(), "omo-ai-beta-"))
  const calls = join(dir, "calls")
  const runnerTempDir = join(dir, "runner-temp")
  mkdirSync(runnerTempDir)
  const stub = [
    "npm() {",
    `  printf '%s\\n' "$*" >> "$CALLS"`,
    `  case "$*" in`,
    `    "dist-tag add "*) [ "\${ADD_FAIL:-}" != 1 ] || return 1`,
    `      spec="\${*: -2:1}"; printf '%s\\n' "\${spec#omo-ai@}" > "$CALLS.moved" ;;`,
    `    *"--json omo-ai dist-tags") [ "\${VIEW_FAIL:-}" != 1 ] || return 1`,
    `      b="$BETA"; ctr="$CALLS.json-reads"; [ -f "$CALLS.moved" ] || ctr="$CALLS.json-reads-unmoved"; reads=$(( $(cat "$ctr" 2>/dev/null || echo 0) + 1 )); echo "$reads" > "$ctr"`,
    `      if [ ! -f "$CALLS.moved" ] && [ -n "\${BETA_SETTLED:-}" ] && [ "$reads" -gt "\${BETA_LAG:-0}" ]; then b="$BETA_SETTLED"; fi`,
    `      if [ -f "$CALLS.moved" ]; then`,
    `        if [ -n "\${AFTER_BETA:-}" ]; then b="$AFTER_BETA"; elif [ "$reads" -gt "\${BETA_LAG:-0}" ]; then b=$(cat "$CALLS.moved"); fi; fi`,
    `      rc=""; [ -z "\${RC:-}" ] || rc=",\\"rc\\":\\"$RC\\""`,
    `      if [ -n "$b" ]; then printf '{"latest":"%s","beta":"%s"%s}\\n' "$LATEST" "$b" "$rc"; else printf '{"latest":"%s"%s}\\n' "$LATEST" "$rc"; fi ;;`,
    `    *dist-tags.latest*) printf '%s\\n' "$LATEST" ;;`,
    `    *dist-tags.beta*) reads=$(( $(cat "$CALLS.beta-reads" 2>/dev/null || echo 0) + 1 )); echo "$reads" > "$CALLS.beta-reads"`,
    `      if [ "$reads" -le "\${BETA_LAG:-0}" ]; then printf '%s\\n' "$BETA"`,
    `      elif [ -f "$CALLS.moved" ]; then cat "$CALLS.moved"`,
    `      else printf '%s\\n' "\${BETA_SETTLED:-$BETA}"; fi ;;`,
    "  esac",
    "}",
    "sleep() { :; }",
    "",
  ].join("\n")
  try {
    const result = spawnSync("bash", ["-c", `${stub}${run}`], {
      cwd: repoRoot,
      encoding: "utf8",
      timeout: 20_000,
      env: { ...process.env, CALLS: calls, RUNNER_TEMP: runnerTempDir, ...env },
    })
    const recorded = existsSync(calls) ? readFileSync(calls, "utf8").trim().split("\n").filter(Boolean) : []
    const runnerTemp = readdirSync(runnerTempDir, { recursive: true, encoding: "utf8" })
      .filter((name) => statSync(join(runnerTempDir, name)).isFile())
      .map((name) => ({ name, content: readFileSync(join(runnerTempDir, name), "utf8") }))
    return { status: result.status, stderr: result.stderr, stdout: result.stdout, calls: recorded, runnerTemp }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

describe("beta follows latest on a stable release (#12987)", () => {
  const betaMove = namedStep("post-publish-verify", "Move omo-ai beta up to the stable release")

  test("the beta move runs in post-publish-verify between the readiness wait and the guard, for a stable release and not gated on already_published", () => {
    // publish-main gates the GitHub release, so a beta-tag hiccup there would strand an already-published version.
    expect(steps("publish-main").map((step) => step.name)).not.toContain("Move omo-ai beta up to the stable release")
    const names = steps("post-publish-verify").map((step) => step.name)
    const moveIndex = names.indexOf("Move omo-ai beta up to the stable release")
    expect(moveIndex).toBe(names.indexOf("Wait for omo-ai registry readiness") + 1)
    expect(names.indexOf("Guard omo-ai dist-tags")).toBe(moveIndex + 1)
    const condition = betaMove.if ?? ""
    expect(condition).toContain("needs.release-metadata.outputs.omo_ai_dist_tag == 'latest'")
    expect(condition).not.toContain("already_published")
    expect(condition).toContain("inputs.lazycodex_only != true")
    expect(betaMove.env?.NODE_AUTH_TOKEN).toBe(actionsExpression("secrets.NODE_AUTH_TOKEN"))
  })

  test("neither beta step is gated on already_published, so a re-run of a published release still repairs beta (#13148)", () => {
    expect(betaMove.if ?? "").not.toContain("already_published")
    expect(namedStep("post-publish-verify", "Guard omo-ai dist-tags").if ?? "").not.toContain("already_published")
  })

  test("the dist-tag guard fails a stale beta even when the release was already published (#13148)", () => {
    const guard = namedStep("post-publish-verify", "Guard omo-ai dist-tags").run ?? ""
    const result = runStep(guard, {
      OMO_AI_VERSION: "5.1.66",
      OMO_AI_DIST_TAG: "latest",
      ALREADY_PUBLISHED: "true",
      LATEST: "5.1.66",
      BETA: "5.1.0",
    })
    expect(result.status).toBe(1)
    expect(result.stdout).toContain("older than latest 5.1.66")
  })

  test("release runs are serialized by a workflow-wide concurrency group that never cancels a running release (#13149)", () => {
    expect(workflow.concurrency).toBe("${{ github.workflow }}-${{ github.ref }}")
    expect(workflowText).not.toContain("cancel-in-progress: true")
  })

  test.each([
    { beta: "5.1.0", moved: true },
    { beta: "", moved: true },
    { beta: "5.1.66", moved: false },
    { beta: "5.2.0-0.beta.1", moved: false },
  ])("publishing 5.1.66 with beta at '$beta' sets beta >= latest (moved: $moved)", ({ beta, moved }) => {
    const result = runStep(betaMove.run ?? "", {
      OMO_AI_VERSION: "5.1.66",
      LATEST: "5.1.66",
      BETA: beta,
      NODE_AUTH_TOKEN: "dummy",
    })
    expect(result.status).toBe(0)
    const tagWrites = result.calls.filter((call) => call.startsWith("dist-tag"))
    if (moved) {
      expect(tagWrites).toHaveLength(1)
      expect(tagWrites[0]).toMatch(/^dist-tag add --userconfig \S+ omo-ai@5\.1\.66 beta$/)
    } else {
      expect(tagWrites).toEqual([])
    }
  })

  test("after a successful move the step waits until beta reads back the moved version", () => {
    const result = runStep(betaMove.run ?? "", {
      OMO_AI_VERSION: "5.1.66",
      LATEST: "5.1.66",
      BETA: "5.1.0",
      BETA_LAG: "2",
      NODE_AUTH_TOKEN: "dummy",
    })
    expect(result.status).toBe(0)
    // one dist-tags read before the write, then re-reads until the moved beta is visible
    expect(result.calls.filter((call) => call.includes("--prefer-online --json omo-ai dist-tags"))).toHaveLength(4)
    expect(result.stdout).toContain("omo-ai beta reads 5.1.66 (attempt 3/5)")
    expect(result.stdout).not.toContain("::warning::")
  })

  test("a beta read-back that never converges is bounded and fails with the exact repair command (#13149)", () => {
    const result = runStep(betaMove.run ?? "", {
      OMO_AI_VERSION: "5.1.66",
      LATEST: "5.1.66",
      BETA: "5.1.0",
      BETA_LAG: "99",
      NODE_AUTH_TOKEN: "dummy",
    })
    expect(result.status).toBe(1)
    expect(result.calls.filter((call) => call.includes("--prefer-online --json omo-ai dist-tags"))).toHaveLength(6)
    expect(result.stdout).toContain("::error::")
    expect(result.stdout).toContain("npm dist-tag add omo-ai@5.1.66 beta")
  })

  test("a beta moved further forward by someone else after our write is logged and left alone (#13149)", () => {
    const result = runStep(betaMove.run ?? "", {
      OMO_AI_VERSION: "5.1.66",
      LATEST: "5.1.66",
      BETA: "5.1.0",
      AFTER_BETA: "5.2.0-0.beta.1",
      NODE_AUTH_TOKEN: "dummy",
    })
    expect(result.status).toBe(0)
    expect(result.stdout).toContain("moved forward")
    expect(result.stdout).not.toContain("::error::")
  })

  test.each<{ name: string; env: Record<string, string> }>([
    { name: "success", env: { BETA: "5.1.0" } },
    { name: "write failure", env: { BETA: "5.1.0", ADD_FAIL: "1" } },
    { name: "lookup failure", env: { BETA: "", VIEW_FAIL: "1" } },
  ])("after a $name the runner temp dir holds no npmrc and no raw token", ({ env }) => {
    const token = "npm_test-token-value-12987"
    const result = runStep(betaMove.run ?? "", {
      OMO_AI_VERSION: "5.1.66",
      LATEST: "5.1.66",
      NODE_AUTH_TOKEN: token,
      ...env,
    })
    expect(result.status).toBe(0)
    expect(result.runnerTemp.map((file) => file.name).filter((name) => name.includes("npmrc"))).toEqual([])
    expect(result.runnerTemp.filter((file) => file.content.includes(token))).toEqual([])
    expect(result.stdout).not.toContain(token)
    expect(result.stderr).not.toContain(token)
  })

  test("a failed dist-tags lookup is retried, never read as a missing beta, and leaves beta untouched with a warning", () => {
    const result = runStep(betaMove.run ?? "", {
      OMO_AI_VERSION: "5.1.66",
      LATEST: "5.1.66",
      BETA: "",
      VIEW_FAIL: "1",
      NODE_AUTH_TOKEN: "dummy",
    })
    expect(result.status).toBe(0)
    expect(result.calls.filter((call) => call.includes("dist-tags"))).toHaveLength(3)
    expect(result.calls.filter((call) => call.startsWith("dist-tag"))).toEqual([])
    expect(result.stdout).toContain("::warning::")
    expect(result.stdout).not.toContain("::error::")
  })

  test("a failed beta move warns instead of failing, leaving the dist-tag guard as the hard check", () => {
    const result = runStep(betaMove.run ?? "", {
      OMO_AI_VERSION: "5.1.66",
      LATEST: "5.1.66",
      BETA: "5.1.0",
      ADD_FAIL: "1",
      NODE_AUTH_TOKEN: "dummy",
    })
    expect(result.status).toBe(0)
    expect(result.calls.filter((call) => call.startsWith("dist-tag add"))).toHaveLength(5)
    expect(result.stdout).toContain("::warning::")
    expect(result.stdout).not.toContain("::error::")
  })

  test.each([
    { distTag: "latest", beta: "5.1.0", passes: false },
    { distTag: "latest", beta: "", passes: false },
    { distTag: "latest", beta: "5.1.66", passes: true },
    { distTag: "latest", beta: "5.2.0-0.beta.1", passes: true },
    { distTag: "latest", beta: "5.2.0-0.beta.1", rc: "5.2.0-0.rc.1", passes: false },
    { distTag: "latest", beta: "5.2.0-0.rc.2", rc: "5.2.0-0.rc.1", passes: true },
  ])(
    "the dist-tag guard with latest 5.1.66, beta '$beta' and rc '$rc' passes: $passes",
    ({ distTag, beta, rc, passes }) => {
      const guard = namedStep("post-publish-verify", "Guard omo-ai dist-tags").run ?? ""
      const result = runStep(guard, {
        OMO_AI_VERSION: "5.1.66",
        OMO_AI_DIST_TAG: distTag,
        ALREADY_PUBLISHED: "false",
        LATEST: "5.1.66",
        BETA: beta,
        RC: rc ?? "",
      })
      expect(result.status).toBe(passes ? 0 : 1)
      if (!passes) expect(result.stdout).toContain("older than latest 5.1.66")
      if (!passes && rc) expect(result.stdout).toContain("move beta to " + rc)
    },
  )

  test("the dist-tag guard re-reads a lagging beta until it reaches latest", () => {
    const guard = namedStep("post-publish-verify", "Guard omo-ai dist-tags").run ?? ""
    const result = runStep(guard, {
      OMO_AI_VERSION: "5.1.66",
      OMO_AI_DIST_TAG: "latest",
      ALREADY_PUBLISHED: "false",
      LATEST: "5.1.66",
      BETA: "5.1.0",
      BETA_LAG: "3",
      BETA_SETTLED: "5.1.66",
    })
    expect(result.status).toBe(0)
    expect(result.calls.filter((call) => call.includes("--json omo-ai dist-tags"))).toHaveLength(4)
    expect(result.stdout).not.toContain("::error::")
  })

  test("the dist-tag guard fails after a bounded number of reads when beta never reaches latest", () => {
    const guard = namedStep("post-publish-verify", "Guard omo-ai dist-tags").run ?? ""
    const result = runStep(guard, {
      OMO_AI_VERSION: "5.1.66",
      OMO_AI_DIST_TAG: "latest",
      ALREADY_PUBLISHED: "false",
      LATEST: "5.1.66",
      BETA: "5.1.0",
      BETA_LAG: "99",
      BETA_SETTLED: "5.1.66",
    })
    expect(result.status).toBe(1)
    expect(result.calls.filter((call) => call.includes("--json omo-ai dist-tags"))).toHaveLength(5)
    expect(result.stdout).toContain("::error::omo-ai beta points to 5.1.0, older than latest 5.1.66")
  })

  test("the dist-tag guard leaves a prerelease's older beta alone", () => {
    const guard = namedStep("post-publish-verify", "Guard omo-ai dist-tags").run ?? ""
    const result = runStep(guard, {
      OMO_AI_VERSION: "5.2.0-0.beta.2",
      OMO_AI_DIST_TAG: "beta",
      ALREADY_PUBLISHED: "false",
      LATEST: "5.1.66",
      BETA: "5.2.0-0.beta.2",
    })
    expect(result.status).toBe(0)
  })

  test("a second installer mirror moves get.omo.dev channels/beta after a stable mirror", () => {
    const mirrorBeta = job("installer-mirror-beta")
    expect(mirrorBeta.uses).toBe("./.github/workflows/installer-mirror.yml")
    expect(mirrorBeta.with).toEqual({
      tag: `v${actionsExpression("needs.release-metadata.outputs.version")}`,
      channel: "beta",
      dry_run: false,
    })
    expect(mirrorBeta.needs).toContain("installer-mirror")
    expect(mirrorBeta.if).toContain("needs.installer-mirror.result == 'success'")
    expect(mirrorBeta.if).toContain("needs.release-metadata.outputs.omo_ai_dist_tag == 'latest'")
  })
})
