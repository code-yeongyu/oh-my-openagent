/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"

const publishWorkflowPath = new URL("../.github/workflows/publish.yml", import.meta.url)

export const resumeGuardFindings = {
  prepareExistingTagReuse: "prepare-release-state must reuse an existing release tag",
  prepareExistingCommitReuse: "prepare-release-state must reuse an existing release commit",
  dispatchTagShaMismatchRefusal: "dispatch-provenance-safe-publish must reject an existing tag at a different SHA",
  ohMyOpencodePublishedProbe: "publish-main must skip an already-published oh-my-opencode version",
  ohMyOpenagentPublishedProbe: "publish-main must skip an already-published oh-my-openagent version",
  lazycodexPublishedProbe: "publish-main must skip an already-published lazycodex-ai version",
  omoAiPublishedMetadata: "release-metadata must expose whether omo-ai is already published",
  marketplaceUnchangedNoOp: "release must leave an unchanged LazyCodex marketplace untouched",
  preparedShaDispatchRouting: "the prepared SHA must select and pin the provenance-bearing publish run",
} as const

function section(workflowText: string, startMarker: string, endMarker?: string): string {
  const start = workflowText.indexOf(startMarker)
  const end = endMarker === undefined ? workflowText.length : workflowText.indexOf(endMarker, start)
  if (start < 0 || end < 0 || end <= start) return ""
  return workflowText.slice(start, end)
}

function hasAll(text: string, required: readonly string[]): boolean {
  return required.every((value) => text.includes(value))
}

export function assertResumeGuards(workflowText: string): string[] {
  const findings: string[] = []
  const releaseMetadata = section(workflowText, "  release-metadata:", "  prepare-release-state:")
  const prepareReleaseState = section(workflowText, "  prepare-release-state:", "  dispatch-provenance-safe-publish:")
  const prepareTagReuse = section(
    prepareReleaseState,
    '          if git rev-parse -q --verify "refs/tags/v${VERSION}"',
    '          RELEASE_SHA="$(git rev-list --max-count=1 --grep=',
  )
  const prepareCommitReuse = section(
    prepareReleaseState,
    '          RELEASE_SHA="$(git rev-list --max-count=1 --grep=',
    '          git checkout -B "$RELEASE_BRANCH"',
  )
  const dispatchPublish = section(workflowText, "  dispatch-provenance-safe-publish:", "  publish-main:")
  const dispatchExistingTag = section(
    dispatchPublish,
    '          if git rev-parse -q --verify "refs/tags/v${VERSION}"',
    "          else\n            git tag",
  )
  const publishMain = section(workflowText, "  publish-main:", "  publish-platform:")
  const opencodeProbe = section(publishMain, "      - name: Check if already published", "      - name: Check if oh-my-openagent already published")
  const openagentProbe = section(publishMain, "      - name: Check if oh-my-openagent already published", "      - name: Check if lazycodex-ai already published")
  const lazycodexProbe = section(publishMain, "      - name: Check if lazycodex-ai already published", "      - name: Update version")
  const omoAiMetadata = section(releaseMetadata, "      - name: Calculate omo-ai metadata", "      - name: Write job summary")
  const release = section(workflowText, "  release:")
  const marketplaceSync = section(release, "      - name: Sync LazyCodex Codex marketplace", "      - name: Resolve LazyCodex release payload")

  if (!hasAll(prepareTagReuse, [
    'git rev-parse -q --verify "refs/tags/v${VERSION}"',
    'RELEASE_SHA="$(git rev-list --max-count=1 "refs/tags/v${VERSION}")"',
    'echo "release_sha=${RELEASE_SHA}" >> "$GITHUB_OUTPUT"',
    'echo "Release tag v${VERSION} already exists locally at ${RELEASE_SHA}"',
    "exit 0",
  ])) findings.push(resumeGuardFindings.prepareExistingTagReuse)

  if (!hasAll(prepareCommitReuse, [
    'git rev-list --max-count=1 --grep="^release: v${VERSION}$" "origin/${BASE_REF}"',
    'echo "Release commit already exists on origin/${BASE_REF}: ${RELEASE_SHA}"',
    "if [ -n \"$RELEASE_SHA\" ]; then",
    "exit 0",
  ])) findings.push(resumeGuardFindings.prepareExistingCommitReuse)

  if (!hasAll(dispatchExistingTag, [
    'if [ "$TAG_SHA" != "$RELEASE_SHA" ]; then',
    'echo "::error::Existing tag v${VERSION} points to ${TAG_SHA}, not prepared release SHA ${RELEASE_SHA}."',
    "exit 1",
  ])) findings.push(resumeGuardFindings.dispatchTagShaMismatchRefusal)

  const packageProbes = [
    [resumeGuardFindings.ohMyOpencodePublishedProbe, opencodeProbe, "id: check", "https://registry.npmjs.org/oh-my-opencode/${VERSION}", "if: steps.check.outputs.skip != 'true'"],
    [resumeGuardFindings.ohMyOpenagentPublishedProbe, openagentProbe, "id: check-openagent", "https://registry.npmjs.org/oh-my-openagent/${VERSION}", "if: steps.check-openagent.outputs.skip != 'true'"],
    [resumeGuardFindings.lazycodexPublishedProbe, lazycodexProbe, "id: check-lazycodex", "https://registry.npmjs.org/lazycodex-ai/${VERSION}", "steps.check-lazycodex.outputs.skip != 'true'"],
  ] as const
  for (const [finding, probe, stepId, registryUrl, publishCondition] of packageProbes) {
    if (!hasAll(probe, [stepId, registryUrl, 'echo "skip=true" >> "$GITHUB_OUTPUT"']) || !publishMain.includes(publishCondition)) {
      findings.push(finding)
    }
  }

  if (!releaseMetadata.includes("already_published: ${{ steps.omo-ai.outputs.already_published }}") || !hasAll(omoAiMetadata, [
    'https://registry.npmjs.org/omo-ai/${OMO_AI_VERSION}',
    'echo "already_published=true" >> "$GITHUB_OUTPUT"',
    'echo "already_published=false" >> "$GITHUB_OUTPUT"',
  ]) || !publishMain.includes("if: needs.release-metadata.outputs.already_published != 'true'")) {
    findings.push(resumeGuardFindings.omoAiPublishedMetadata)
  }

  if (!hasAll(marketplaceSync, [
    "if git diff --cached --quiet; then",
    'echo "LazyCodex marketplace already up to date"',
    "else",
    'git push origin HEAD:main',
  ])) findings.push(resumeGuardFindings.marketplaceUnchangedNoOp)

  if (!hasAll(workflowText, [
    "prepared_release_sha:",
    "inputs.prepared_release_sha == ''",
    "inputs.prepared_release_sha != ''",
    'gh workflow run publish.yml --ref "v${VERSION}"',
    '-f "prepared_release_sha=${RELEASE_SHA}"',
    'if [ "$PREPARED_RELEASE_SHA" != "$GITHUB_SHA" ]; then',
  ])) findings.push(resumeGuardFindings.preparedShaDispatchRouting)

  return findings
}

describe("publish resume idempotency", () => {
  test("keeps every resumability guard in the real publish workflow", () => {
    const workflowText = readFileSync(publishWorkflowPath, "utf8")

    expect(assertResumeGuards(workflowText)).toEqual([])
  })

  test("reports the exact guard removed by an in-memory mutation", () => {
    const workflowText = readFileSync(publishWorkflowPath, "utf8")
    const mutatedWorkflow = workflowText.replace(
      'if [ "$TAG_SHA" != "$RELEASE_SHA" ]; then',
      'if false; then # mutation: mismatch refusal removed',
    )

    expect(mutatedWorkflow).not.toBe(workflowText)
    expect(assertResumeGuards(mutatedWorkflow)).toEqual([
      resumeGuardFindings.dispatchTagShaMismatchRefusal,
    ])
  })
})
