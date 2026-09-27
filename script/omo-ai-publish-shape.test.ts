/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
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
