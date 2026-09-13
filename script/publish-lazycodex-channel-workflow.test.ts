/// <reference types="bun-types" />

// LazyCodex channel contract for publish.yml (issue #8175): prereleases propagate LazyCodex exactly
// like stable releases, and `lazycodex_only` publishes LazyCodex without touching any omo surface.

import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"

interface WorkflowStep {
  readonly name?: string
  readonly if?: string
  readonly run?: string
  readonly env?: Record<string, string>
}

interface WorkflowJob {
  readonly if?: string
  readonly steps?: readonly WorkflowStep[]
}

interface Workflow {
  readonly on: { readonly workflow_dispatch: { readonly inputs: Record<string, { readonly type: string; readonly default?: unknown }> } }
  readonly jobs: Record<string, WorkflowJob>
}

const workflowPath = new URL("../.github/workflows/publish.yml", import.meta.url)
const workflowText = readFileSync(workflowPath, "utf8").replace(/\r\n/g, "\n")
const workflow = Bun.YAML.parse(workflowText) as Workflow

function job(name: string): WorkflowJob {
  const found = workflow.jobs[name]
  if (found === undefined) throw new Error(`publish.yml has no job ${name}`)
  return found
}

function step(jobName: string, stepName: string): WorkflowStep {
  const found = job(jobName).steps?.find((candidate) => candidate.name === stepName)
  if (found === undefined) throw new Error(`publish.yml job ${jobName} has no step ${stepName}`)
  return found
}

function run(jobName: string, stepName: string): string {
  const body = step(jobName, stepName).run
  if (body === undefined) throw new Error(`publish.yml step ${jobName}/${stepName} has no run block`)
  return body
}

function shellBranch(body: string, opener: string): string {
  const start = body.indexOf(opener)
  if (start < 0) throw new Error(`shell body has no branch opening with ${opener}`)
  const end = body.indexOf("\nfi\n", start)
  return body.slice(start, end < 0 ? undefined : end)
}

const PUBLISH_LAZYCODEX = "inputs.publish_lazycodex == true"
const NOT_LAZYCODEX_ONLY = "inputs.lazycodex_only != true"

describe("LazyCodex publish channels", () => {
  test("every channel that publishes lazycodex-ai also syncs the marketplace and cuts the LazyCodex release", () => {
    // #given
    const releaseStep = step("release", "Create LazyCodex GitHub release")
    const releaseRun = run("release", "Create LazyCodex GitHub release")

    // #when
    const marketplaceGates = [
      step("preflight-trust", "Require LazyCodex sync token").if,
      step("release", "Checkout LazyCodex marketplace").if,
      step("release", "Sync LazyCodex Codex marketplace").if,
      step("release", "Resolve LazyCodex release payload").if,
    ]
    const onlyBranch = shellBranch(releaseRun, 'if [ "${LAZYCODEX_ONLY:-}" = "true" ]; then')

    // #then
    for (const gate of marketplaceGates) expect(gate).toBe(PUBLISH_LAZYCODEX)
    expect(releaseStep.if).toBe(`${PUBLISH_LAZYCODEX} && steps.lazycodex-release-state.outputs.lazycodex_changed == 'true'`)
    expect(releaseStep.env?.RELEASE_SHA).toBe("${{ needs.prepare-release-state.outputs.release_sha }}")
    expect(onlyBranch).toContain("${RELEASE_SHA}")
    expect(releaseRun).not.toContain("dist_tag")
  })

  test("lazycodex_only is a dispatch input that reaches the provenance-safe child under its own tag namespace", () => {
    // #given
    const input = workflow.on.workflow_dispatch.inputs.lazycodex_only
    const dispatchRun = run("dispatch-provenance-safe-publish", "Tag prepared source and dispatch provenance-safe publish")
    const metadataRun = run("release-metadata", "Calculate version")

    // #when
    const onlyBranch = shellBranch(dispatchRun, 'if [ "${LAZYCODEX_ONLY:-}" = "true" ]; then')
    const metadataGuard = shellBranch(metadataRun, 'if [ "$LAZYCODEX_ONLY" = "true" ]; then')

    // #then
    expect(input?.type).toBe("boolean")
    expect(input?.default).toBe(false)
    expect(dispatchRun).toContain('RELEASE_TAG="v${VERSION}"')
    expect(onlyBranch).toContain('RELEASE_TAG="lazycodex-v${VERSION}"')
    expect(dispatchRun).toContain('git tag "${RELEASE_TAG}" "$RELEASE_SHA"')
    expect(dispatchRun).toContain('gh workflow run publish.yml --ref "${RELEASE_TAG}"')
    expect(dispatchRun).toContain('-f "lazycodex_only=${LAZYCODEX_ONLY}"')
    expect(metadataGuard).toContain('if [ -z "$RAW_VERSION" ]; then')
    expect(metadataGuard).toContain('if [ "$PUBLISH_LAZYCODEX" != "true" ]; then')
  })

  test("lazycodex_only publishes the base head without stamping and refuses a version either release path already used", () => {
    // #given
    const prepareRun = run("prepare-release-state", "Prepare release state (generation)")

    // #when
    const onlyBranch = shellBranch(prepareRun, 'if [ "${LAZYCODEX_ONLY:-}" = "true" ]; then')
    const afterOnlyBranch = prepareRun.slice(prepareRun.indexOf(onlyBranch) + onlyBranch.length)
    const omoRefusal = afterOnlyBranch.indexOf('refs/tags/lazycodex-v${VERSION}')

    // #then
    expect(onlyBranch).toContain('git rev-parse -q --verify "refs/tags/lazycodex-v${VERSION}"')
    expect(onlyBranch).toContain('git rev-parse -q --verify "refs/tags/v${VERSION}"')
    expect(onlyBranch).toContain('https://registry.npmjs.org/lazycodex-ai/${VERSION}')
    expect(onlyBranch).toContain('echo "release_sha=${BASE_HEAD}" >> "$GITHUB_OUTPUT"')
    expect(onlyBranch).toContain('echo "needs_push=false" >> "$GITHUB_OUTPUT"')
    expect(onlyBranch).not.toContain("git commit")
    expect(omoRefusal).toBeGreaterThanOrEqual(0)
    expect(omoRefusal).toBeLessThan(afterOnlyBranch.indexOf("reuse_or_refuse() {"))
  })

  test("lazycodex_only skips every omo publish, release, and verification surface", () => {
    // #given
    const omoSkippedSteps: ReadonlyArray<readonly [string, string]> = [
      ["publish-main", "Verify platform packages are published"],
      ["publish-main", "Build omo-ai payload"],
      ["publish-main", "Verify omo-ai payload"],
      ["publish-main", "Strip token auth before omo-ai publish"],
      ["publish-main", "Publish omo-ai (beta only)"],
      ["release", "Generate changelog"],
      ["release", "Create GitHub release"],
      ["release", "Download release-binary artifacts"],
      ["release", "Upload release assets"],
      ["release", "Verify uploaded assets"],
      ["release", "Delete draft release"],
      ["release", "Mirror release to master"],
      ["post-publish-verify", "Wait for omo-ai registry readiness"],
      ["post-publish-verify", "Guard omo-ai dist-tags"],
      ["post-publish-verify", "Verify omo-ai live install"],
    ]
    const wrapperProbes = [
      run("publish-main", "Check if already published"),
      run("publish-main", "Check if oh-my-openagent already published"),
    ]

    // #then
    for (const [jobName, stepName] of omoSkippedSteps) {
      expect(step(jobName, stepName).if, `${jobName}/${stepName} must skip under lazycodex_only`).toContain(NOT_LAZYCODEX_ONLY)
    }
    expect(job("verify-release-notes").if).toContain(NOT_LAZYCODEX_ONLY)
    expect(job("publish-platform").if).toContain(NOT_LAZYCODEX_ONLY)
    for (const jobName of ["publish-main", "release"]) {
      expect(job(jobName).if).toContain("inputs.skip_platform == true || inputs.lazycodex_only == true || needs.publish-platform.result == 'success'")
    }
    for (const probe of wrapperProbes) {
      const onlyBranch = shellBranch(probe, 'if [ "$LAZYCODEX_ONLY" = "true" ]; then')
      expect(onlyBranch).toContain('echo "skip=true" >> "$GITHUB_OUTPUT"')
      expect(probe.indexOf(onlyBranch)).toBeLessThan(probe.indexOf("STATUS=$(curl"))
    }
    expect(step("publish-main", "Publish lazycodex-ai").if).not.toContain("lazycodex_only")
    expect(step("post-publish-verify", "Smoke test published lazycodex-ai").if).not.toContain("lazycodex_only")
  })

  test("publish-time plugin builds stamp the manifests an unstamped tree would otherwise leave behind", () => {
    // #given
    const buildRuns = [run("publish-main", "Build Codex plugin components"), run("release", "Sync LazyCodex Codex marketplace")]

    // #then
    for (const body of buildRuns) {
      const versionSync = body.indexOf("node packages/omo-codex/plugin/scripts/sync-version.mjs")
      const hookSync = body.indexOf("node packages/omo-codex/plugin/scripts/sync-hook-status-messages.mjs")
      expect(versionSync).toBeGreaterThanOrEqual(0)
      expect(hookSync).toBeGreaterThan(versionSync)
      expect(body.indexOf("npm --prefix packages/omo-codex/plugin ci")).toBeGreaterThan(hookSync)
    }
  })
})
