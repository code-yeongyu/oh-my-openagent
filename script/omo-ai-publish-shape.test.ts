/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"

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

const DIST_TAG_FIXTURE = `          if [[ "$VERSION" == *"-"* ]]; then
            DIST_TAG=$(printf '%s' "$VERSION" | cut -d'-' -f2 | cut -d'.' -f1)
            if ! [[ "$DIST_TAG" =~ ^[a-z][a-z0-9-]*$ ]]; then
              echo "::error::Invalid dist_tag: $DIST_TAG"
              exit 1
            fi
            echo "dist_tag=\${DIST_TAG:-next}" >> "$GITHUB_OUTPUT"
          else
            DIST_TAG=""
            echo "dist_tag=" >> "$GITHUB_OUTPUT"
          fi`

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
    ? `${rootVersion}-1`
    : `${rootVersion.slice(0, prereleaseIndex)}-0.${rootVersion.slice(prereleaseIndex + 1)}`
}

function extractDistTagBlock(text: string): string {
  const start = text.indexOf('          if [[ "$VERSION" == *"-"* ]]; then')
  const endMarker = '          fi\n\n          LAZYCODEX_COMPARE_TAG='
  const end = text.indexOf(endMarker, start)
  if (start < 0 || end < 0) throw new Error("missing DIST_TAG derivation block")
  return text.slice(start, end + "          fi".length)
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
    expect(versionRun).toContain(String.raw`^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z]+(\.[0-9A-Za-z]+)*)?$`)
    expect(versionRun).toContain('DIST_TAG=$(printf \'%s\' "$VERSION" | cut -d\'-\' -f2 | cut -d\'.\' -f1)')
  })

  test("marks GitHub releases as prereleases exactly when the version has a prerelease suffix", () => {
    // given
    const releaseRun = namedStep("release", "Create GitHub release").run ?? ""

    // when / then
    expect(releaseRun).toContain('if [[ "$VERSION" == *"-"* ]]; then')
    expect(releaseRun).toContain("RELEASE_FLAGS+=(--prerelease)")
    expect(releaseRun).toContain('gh release create "v${VERSION}" "${RELEASE_FLAGS[@]}"')
  })

  test("maps every root release to a unique ordered prerelease", () => {
    const inputs = ["1.2.3-alpha", "1.2.3-beta.0", "1.2.3-beta.1", "1.2.3-rc.1", "1.2.3"]
    const expected = ["1.2.3-0.alpha", "1.2.3-0.beta.0", "1.2.3-0.beta.1", "1.2.3-0.rc.1", "1.2.3-1"]
    const outputs = inputs.map(mapOmoAiVersion)
    const metadataRun = namedStep("release-metadata", "Calculate omo-ai metadata").run ?? ""

    expect(outputs).toEqual(expected)
    expect(new Set(outputs).size).toBe(outputs.length)
    expect(outputs.every((version) => version.includes("-"))).toBe(true)
    for (let index = 1; index < outputs.length; index += 1) {
      expect(Bun.semver.order(outputs[index - 1]!, outputs[index]!)).toBeLessThan(0)
    }
    expect(metadataRun).toContain('OMO_AI_VERSION="${VERSION}-1"')
    expect(metadataRun).toContain('OMO_AI_VERSION="${VERSION/-/-0.}"')
    expect(metadataRun).toContain("https://registry.npmjs.org/omo-ai/${OMO_AI_VERSION}")
    expect(job("release-metadata").outputs?.omo_ai_version).toBe("${{ steps.omo-ai.outputs.omo_ai_version }}")
    expect(job("release-metadata").outputs?.already_published).toBe("${{ steps.omo-ai.outputs.already_published }}")
  })

  test("checks out before asserting root bin ownership", () => {
    const metadataSteps = steps("release-metadata")
    const checkoutIndex = metadataSteps.findIndex((step) => step.uses === "actions/checkout@v5")
    const assertionIndex = metadataSteps.findIndex((step) => step.name === "Assert omo bin ownership")
    const assertionRun = metadataSteps[assertionIndex]?.run ?? ""

    expect(checkoutIndex).toBe(0)
    expect(assertionIndex).toBeGreaterThan(checkoutIndex)
    expect(assertionRun).toContain("jq -e '.bin.omo' package.json")
    expect(assertionRun).toContain("docs/reference/omo-ai-publishing.md")
  })

  test("stamps omo-native in both release paths and stages its manifest", () => {
    const prepare = namedStep("prepare-release-state", "Prepare release state (generation)")
    const update = namedStep("publish-main", "Update version")
    const stampLine = `jq --arg v "$OMO_AI_VERSION" '.version = $v' packages/omo-native/package.json > tmp.json && mv tmp.json packages/omo-native/package.json`

    expect(prepare.env?.OMO_AI_VERSION).toBe("${{ needs.release-metadata.outputs.omo_ai_version }}")
    expect(update.env?.OMO_AI_VERSION).toBe("${{ needs.release-metadata.outputs.omo_ai_version }}")
    expect(prepare.run).toContain(stampLine)
    expect(update.run).toContain(stampLine)
    expect(prepare.run).toContain("git add package.json packages/omo-native/package.json ")
  })

  test("builds and verifies the payload before stripping token auth", () => {
    const publishSteps = steps("publish-main")
    const containmentIndex = publishSteps.findIndex((step) => step.name === "Verify npm payload containment")
    const buildIndex = publishSteps.findIndex((step) => step.name === "Build omo-ai payload")
    const verifyIndex = publishSteps.findIndex((step) => step.name === "Verify omo-ai payload")
    const originalStripIndex = publishSteps.findIndex((step) => step.name === "Strip token auth from .npmrc to force OIDC")

    expect(buildIndex).toBe(containmentIndex + 1)
    expect(verifyIndex).toBe(buildIndex + 1)
    expect(originalStripIndex).toBe(verifyIndex + 1)
  })

  test("publishes omo-ai through beta-only OIDC after every wrapper publish", () => {
    const publishSteps = steps("publish-main")
    const originalStripIndex = publishSteps.findIndex((step) => step.name === "Strip token auth from .npmrc to force OIDC")
    const lastWrapperPublishIndex = publishSteps.findIndex((step) => step.name === "Publish lazycodex-ai")
    const dedicatedStripIndex = publishSteps.findIndex((step) => step.name === "Strip token auth before omo-ai publish")
    const publishIndex = publishSteps.findIndex((step) => step.name === "Publish omo-ai (beta only)")
    const publish = publishSteps[publishIndex]!
    const dedicatedStrip = publishSteps[dedicatedStripIndex]!

    expect(publishIndex).toBeGreaterThan(originalStripIndex)
    expect(publishIndex).toBeGreaterThan(lastWrapperPublishIndex)
    expect(dedicatedStripIndex).toBe(publishIndex - 1)
    expect(dedicatedStrip.if).toBe("needs.release-metadata.outputs.already_published != 'true'")
    expect(publish.if).toBe("needs.release-metadata.outputs.already_published != 'true'")
    expect(publish["working-directory"]).toBe("packages/omo-native")
    expect(publish.run).toContain("npm publish --ignore-scripts --access public --provenance --tag beta")
    expect(publish.run, "omo-ai publish must hardcode --tag beta rather than DIST_TAG").not.toContain("$DIST_TAG")
    expect(publish.env ?? {}).not.toHaveProperty("NODE_AUTH_TOKEN")
  })

  test("always runs readiness, dist-tag guard, and live verification", () => {
    // These probes moved out of publish-main into post-publish-verify: they assert registry state that is
    // already public once publish-main succeeds, so gating the release job on them could only strand a
    // published release. They stay unconditional inside their new job.
    for (const name of ["Wait for omo-ai registry readiness", "Guard omo-ai dist-tags", "Verify omo-ai live install"]) {
      const step = namedStep("post-publish-verify", name)
      expect(step).not.toHaveProperty("if")
      expect(step.env?.OMO_AI_VERSION).toBe("${{ needs.release-metadata.outputs.omo_ai_version }}")
      expect(step.env?.ALREADY_PUBLISHED).toBe("${{ needs.release-metadata.outputs.already_published }}")
    }

    expect(namedStep("post-publish-verify", "Wait for omo-ai registry readiness").run).toContain("npm view omo-ai@$OMO_AI_VERSION version")
    expect(namedStep("post-publish-verify", "Guard omo-ai dist-tags").run).toContain("0.0.0-beta.0")
    const liveRun = namedStep("post-publish-verify", "Verify omo-ai live install").run ?? ""
    expect(liveRun).toContain('npm i -g "omo-ai@$OMO_AI_VERSION"')
    expect(liveRun).toContain("lib/node_modules/omo-ai/package.json")
    expect(liveRun).toContain('"$EXACT_PREFIX/bin/omo" --version')
    expect(liveRun).toContain("npm i -g omo-ai@beta")
    expect(liveRun).toContain("npm i -g omo-ai")
    expect(liveRun).toContain("ETARGET")
  })

  test("keeps trusted publishing unconditional and DIST_TAG derivation byte-pinned", () => {
    const preflightRun = namedStep("preflight-trust", "Verify trusted publisher for release packages").run ?? ""

    expect(preflightRun).toContain("ALL_PACKAGES=(oh-my-opencode oh-my-openagent omo-ai)")
    expect(preflightRun).toContain("docs/reference/omo-ai-publishing.md")
    expect(extractDistTagBlock(workflowText)).toBe(DIST_TAG_FIXTURE)
  })
})
