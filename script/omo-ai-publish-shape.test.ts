/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test"
import { spawnSync } from "node:child_process"
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs"
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
    expect(readinessRun).toContain('curl --fail --silent --location --connect-timeout 10 --max-time 15 --head --output /dev/null "$TARBALL_URL"')
  })

  test("preserves an explicit prerelease version and derives its beta dist tag", () => {
    // given
    const versionRun = namedStep("release-metadata", "Calculate version").run ?? ""

    // when
    const explicitVersionPrecedesBump = versionRun.indexOf('VERSION="$RAW_VERSION"') <
      versionRun.indexOf('if [ -z "$VERSION" ]')

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
function runStep(run: string, env: Record<string, string>): { status: number | null; stderr: string; stdout: string; calls: string[] } {
  const dir = mkdtempSync(join(tmpdir(), "omo-ai-beta-"))
  const calls = join(dir, "calls")
  const stub = [
    "npm() {",
    `  printf '%s\\n' "$*" >> "$CALLS"`,
    `  case "$*" in`,
    `    "dist-tag add "*) [ "\${ADD_FAIL:-}" != 1 ] ;;`,
    `    *"--json omo-ai dist-tags") [ "\${VIEW_FAIL:-}" != 1 ] || return 1`,
    `      if [ -n "$BETA" ]; then printf '{"latest":"%s","beta":"%s"}\\n' "$LATEST" "$BETA"; else printf '{"latest":"%s"}\\n' "$LATEST"; fi ;;`,
    `    *dist-tags.latest*) printf '%s\\n' "$LATEST" ;;`,
    `    *dist-tags.beta*) printf '%s\\n' "$BETA" ;;`,
    "  esac",
    "}",
    "sleep() { :; }",
    "",
  ].join("\n")
  try {
    const result = spawnSync("bash", ["-c", `${stub}${run}`], {
      cwd: repoRoot, encoding: "utf8", timeout: 20_000,
      env: { ...process.env, CALLS: calls, RUNNER_TEMP: dir, ...env },
    })
    const recorded = existsSync(calls) ? readFileSync(calls, "utf8").trim().split("\n").filter(Boolean) : []
    return { status: result.status, stderr: result.stderr, stdout: result.stdout, calls: recorded }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

describe("beta follows latest on a stable release (#12987)", () => {
  const betaMove = namedStep("post-publish-verify", "Move omo-ai beta up to the stable release")

  test("the beta move runs in post-publish-verify between the readiness wait and the guard, for a fresh stable release only", () => {
    // publish-main gates the GitHub release, so a beta-tag hiccup there would strand an already-published version.
    expect(steps("publish-main").map((step) => step.name)).not.toContain("Move omo-ai beta up to the stable release")
    const names = steps("post-publish-verify").map((step) => step.name)
    const moveIndex = names.indexOf("Move omo-ai beta up to the stable release")
    expect(moveIndex).toBe(names.indexOf("Wait for omo-ai registry readiness") + 1)
    expect(names.indexOf("Guard omo-ai dist-tags")).toBe(moveIndex + 1)
    const condition = betaMove.if ?? ""
    expect(condition).toContain("needs.release-metadata.outputs.omo_ai_dist_tag == 'latest'")
    expect(condition).toContain("needs.release-metadata.outputs.already_published != 'true'")
    expect(condition).toContain("inputs.lazycodex_only != true")
    expect(betaMove.env?.NODE_AUTH_TOKEN).toBe(actionsExpression("secrets.NODE_AUTH_TOKEN"))
  })

  test.each([
    { beta: "5.1.0", moved: true },
    { beta: "", moved: true },
    { beta: "5.1.66", moved: false },
    { beta: "5.2.0-0.beta.1", moved: false },
  ])("publishing 5.1.66 with beta at '$beta' sets beta >= latest (moved: $moved)", ({ beta, moved }) => {
    const result = runStep(betaMove.run ?? "", { OMO_AI_VERSION: "5.1.66", LATEST: "5.1.66", BETA: beta, NODE_AUTH_TOKEN: "dummy" })
    expect(result.status).toBe(0)
    const tagWrites = result.calls.filter((call) => call.startsWith("dist-tag"))
    if (moved) {
      expect(tagWrites).toHaveLength(1)
      expect(tagWrites[0]).toMatch(/^dist-tag add --userconfig \S+ omo-ai@5\.1\.66 beta$/)
    } else {
      expect(tagWrites).toEqual([])
    }
  })

  test("a failed dist-tags lookup is retried, never read as a missing beta, and leaves beta untouched with a warning", () => {
    const result = runStep(betaMove.run ?? "", { OMO_AI_VERSION: "5.1.66", LATEST: "5.1.66", BETA: "", VIEW_FAIL: "1", NODE_AUTH_TOKEN: "dummy" })
    expect(result.status).toBe(0)
    expect(result.calls.filter((call) => call.includes("dist-tags"))).toHaveLength(3)
    expect(result.calls.filter((call) => call.startsWith("dist-tag"))).toEqual([])
    expect(result.stdout).toContain("::warning::")
    expect(result.stdout).not.toContain("::error::")
  })

  test("a failed beta move warns instead of failing, leaving the dist-tag guard as the hard check", () => {
    const result = runStep(betaMove.run ?? "", { OMO_AI_VERSION: "5.1.66", LATEST: "5.1.66", BETA: "5.1.0", ADD_FAIL: "1", NODE_AUTH_TOKEN: "dummy" })
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
  ])("the dist-tag guard with latest 5.1.66 and beta '$beta' passes: $passes", ({ distTag, beta, passes }) => {
    const guard = namedStep("post-publish-verify", "Guard omo-ai dist-tags").run ?? ""
    const result = runStep(guard, { OMO_AI_VERSION: "5.1.66", OMO_AI_DIST_TAG: distTag, ALREADY_PUBLISHED: "false", LATEST: "5.1.66", BETA: beta })
    expect(result.status).toBe(passes ? 0 : 1)
    if (!passes) expect(result.stdout).toContain("older than latest 5.1.66")
  })

  test("the dist-tag guard leaves a prerelease's older beta alone", () => {
    const guard = namedStep("post-publish-verify", "Guard omo-ai dist-tags").run ?? ""
    const result = runStep(guard, { OMO_AI_VERSION: "5.2.0-0.beta.2", OMO_AI_DIST_TAG: "beta", ALREADY_PUBLISHED: "false", LATEST: "5.1.66", BETA: "5.2.0-0.beta.2" })
    expect(result.status).toBe(0)
  })

  test("a second installer mirror moves get.omo.dev channels/beta after a stable mirror", () => {
    const mirrorBeta = job("installer-mirror-beta")
    expect(mirrorBeta.uses).toBe("./.github/workflows/installer-mirror.yml")
    expect(mirrorBeta.with).toEqual({ tag: `v${actionsExpression("needs.release-metadata.outputs.version")}`, channel: "beta", dry_run: false })
    expect(mirrorBeta.needs).toContain("installer-mirror")
    expect(mirrorBeta.if).toContain("needs.installer-mirror.result == 'success'")
    expect(mirrorBeta.if).toContain("needs.release-metadata.outputs.omo_ai_dist_tag == 'latest'")
  })
})
