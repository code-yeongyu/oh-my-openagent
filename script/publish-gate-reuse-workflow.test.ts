/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"

const publishWorkflowPath = new URL("../.github/workflows/publish.yml", import.meta.url)

function sliceWorkflowSection(workflow: string, startMarker: string, endMarker: string): string {
  const start = workflow.indexOf(startMarker)
  const end = workflow.indexOf(endMarker, start)
  if (start < 0 || end < 0 || end <= start) {
    throw new Error(`missing workflow section between ${startMarker} and ${endMarker}`)
  }
  return workflow.slice(start, end)
}

function sliceWorkflowSectionToEnd(workflow: string, startMarker: string): string {
  const start = workflow.indexOf(startMarker)
  if (start < 0) throw new Error(`missing workflow section starting at ${startMarker}`)
  return workflow.slice(start)
}

describe("publish gate reuse", () => {
  test("waits for a successful CI push workflow run on the exact prepared SHA", () => {
    const workflow = readFileSync(publishWorkflowPath, "utf8")
    const gateReuseJob = sliceWorkflowSection(workflow, "  gate-reuse:", "  preflight-trust:")

    expect(gateReuseJob).toContain("actions: read")
    expect(gateReuseJob).toContain("PREPARED_RELEASE_SHA: ${{ inputs.prepared_release_sha }}")
    expect(gateReuseJob).toContain('if [ -z "$PREPARED_RELEASE_SHA" ]')
    expect(gateReuseJob).toContain("actions/workflows/ci.yml/runs")
    expect(gateReuseJob).toContain("head_sha")
    // The exact-SHA predicate accepts either the post-merge push run or the
    // release PR's pull_request run: the grep/tag short-circuits return the
    // stamp commit, which only ever has a pull_request run.
    expect(gateReuseJob).toContain('.head_sha == $sha')
    expect(gateReuseJob).toContain('.status == "completed"')
    expect(gateReuseJob).toContain('.conclusion == "success"')
    expect(gateReuseJob).not.toContain('event=push')
    expect(gateReuseJob).not.toContain('.event == "push"')
    expect(gateReuseJob).toContain("retry_gh")
    expect(gateReuseJob).toContain("set -euo pipefail")
    expect(gateReuseJob).not.toContain("check-runs")
    expect(gateReuseJob).not.toContain("REQUIRED_CHECKS")
    expect(gateReuseJob).not.toContain("continue-on-error")
  })

  test("removes release-local test jobs and gates publication on CI reuse", () => {
    const workflow = readFileSync(publishWorkflowPath, "utf8")
    const prepareJob = sliceWorkflowSection(workflow, "  prepare-release-state:", "  dispatch-provenance-safe-publish:")
    const publishMainJob = sliceWorkflowSection(workflow, "  publish-main:", "  publish-platform:")
    const publishPlatformJob = sliceWorkflowSection(workflow, "  publish-platform:", "  release:")

    expect(workflow).not.toContain("\n  test:\n")
    expect(workflow).not.toContain("\n  typecheck:\n")
    expect(workflow).not.toContain("\n  codex-compatibility:\n")
    for (const job of [prepareJob, publishMainJob, publishPlatformJob]) {
      expect(job).toContain("gate-reuse")
      expect(job).toContain("needs.gate-reuse.result == 'success'")
      expect(job).not.toContain("needs.test")
      expect(job).not.toContain("needs.typecheck")
      expect(job).not.toContain("needs.codex-compatibility")
    }
  })

  test("uses a workflow-capable token and retries release PR writes", () => {
    const workflow = readFileSync(publishWorkflowPath, "utf8")
    const prepareJob = sliceWorkflowSection(workflow, "  prepare-release-state:", "  dispatch-provenance-safe-publish:")

    expect(prepareJob).toContain("token: ${{ secrets.GH_PAT }}")
    expect(prepareJob).toContain("create_release_pr()")
    expect(prepareJob).toContain("enable_release_auto_merge()")
    expect(prepareJob).toContain("gh pr create")
    expect(prepareJob).toContain("gh pr merge")
    expect(prepareJob).toContain('retry_gh "Read release-state PR state" gh pr view')
    expect(prepareJob).toContain('retry_gh "Read release-state PR checks" gh pr view')
  })

  test("scopes the release PAT away from repo-controlled generation", () => {
    const workflow = readFileSync(publishWorkflowPath, "utf8")
    const prepareJob = sliceWorkflowSection(workflow, "  prepare-release-state:", "  dispatch-provenance-safe-publish:")

    // The checkout must not leave the PAT in git config for repo scripts to read.
    expect(prepareJob).toContain("persist-credentials: false")

    // Generation and privileged publication are separate steps: the generation
    // step must carry no form of the PAT in its environment at all.
    const generationStep = prepareJob.slice(
      prepareJob.indexOf("name: Prepare release state"),
      prepareJob.indexOf("name: Publish prepared release state"),
    )
    expect(generationStep).not.toContain("GH_PAT")
    expect(generationStep).not.toContain("RELEASE_PAT")
    expect(generationStep).not.toContain("GH_TOKEN")

    // The privileged step owns the only credential and runs no repo-controlled
    // generation scripts that could read it.
    const privilegedStep = prepareJob.slice(
      prepareJob.indexOf("name: Publish prepared release state"),
      prepareJob.indexOf("name: Write job summary"),
    )
    expect(privilegedStep).toContain("GH_TOKEN: ${{ secrets.GH_PAT }}")
    for (const repoControlled of [
      "node packages/",
      "jq -",
      "npm --prefix",
      "bun install",
      "bun run",
      "build-extension",
      "sync-version",
    ]) {
      expect(privilegedStep).not.toContain(repoControlled)
    }

    // The token-bearing remote URL must be removed even when git push fails
    // under set -euo pipefail: an EXIT trap restores the clean URL before any
    // later repo-controlled step (the always() summary) can read .git/config.
    expect(privilegedStep).toContain("trap 'git remote set-url origin")
    expect(privilegedStep).toContain("https://github.com/\${GITHUB_REPOSITORY}.git\"' EXIT")

    // Least-scope permissions: this job needs neither Actions reads nor OIDC.
    expect(prepareJob).not.toContain("id-token: write")
    expect(prepareJob).not.toContain("actions: read")
  })

  test("keeps every publication surface pinned to a prepared release SHA", () => {
    const workflow = readFileSync(publishWorkflowPath, "utf8")
    const publishMainJob = sliceWorkflowSection(workflow, "  publish-main:", "  publish-platform:")
    const publishPlatformJob = sliceWorkflowSection(workflow, "  publish-platform:", "  release:")
    const releaseJob = sliceWorkflowSectionToEnd(workflow, "  release:")

    expect(publishMainJob).toContain("inputs.prepared_release_sha != ''")
    expect(publishPlatformJob).toContain("inputs.prepared_release_sha != ''")
    expect(releaseJob).toContain("inputs.prepared_release_sha != ''")
  })
})
