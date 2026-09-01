/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"

const releaseAnalysisFiles = [
  ".agents/skills/get-unpublished-changes/SKILL.md",
  ".agents/skills/pre-publish-review/SKILL.md",
  ".opencode/skills/pre-publish-review/SKILL.md",
  ".agents/command/get-unpublished-changes.md",
  ".opencode/command/get-unpublished-changes.md",
] as const

const publishRunbookFiles = [
  ".agents/skills/publish/SKILL.md",
  ".agents/command/publish.md",
  ".opencode/command/publish.md",
] as const

function readProjectFile(path: string): string {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8")
}

function normalizedText(path: string): string {
  return readProjectFile(path).toLowerCase()
}

function normalizedRunbookBody(path: string): string {
  return readProjectFile(path).replace(/^---\n[\s\S]*?\n---\n+/, "").trim()
}

describe("release skill layering", () => {
  test("#given release analysis skills and commands #when inspected #then they require all release layers", () => {
    // given
    const files = releaseAnalysisFiles

    // when
    const missingLayers = files.flatMap((file) => {
      const text = normalizedText(file)
      return ["omo pure components", "omo opencode", "omo codex"]
        .filter((layer) => !text.includes(layer))
        .map((layer) => `${file}: ${layer}`)
    })
    const missingVersioning = files.filter((file) => {
      const text = normalizedText(file)
      return !text.includes("layer-specific version") && !text.includes("per-layer version")
    })

    // then
    expect(missingLayers).toEqual([])
    expect(missingVersioning).toEqual([])
  })

  test("#given publish runbooks #when normalized #then the skill and command bodies stay synchronized", () => {
    // given
    const files = publishRunbookFiles

    // when
    const bodies = files.map(normalizedRunbookBody)

    // then
    expect(new Set(bodies).size).toBe(1)
  })

  test("#given publish runbooks #when explicit semver routing is inspected #then it is validated and dispatched as version", () => {
    // given
    const files = publishRunbookFiles

    // when
    const missingExplicitVersionDispatch = files.filter((file) => {
      const text = readProjectFile(file)
      return !text.includes('RELEASE_INPUT="${ARGUMENTS}"') ||
        !text.includes('^([0-9]+\\.){2}[0-9]+(-[0-9A-Za-z]+(\\.[0-9A-Za-z]+)*)?$') ||
        !text.includes('-f "version=${RELEASE_INPUT}"')
    })
    const missingBumpDispatch = files.filter((file) => {
      const text = readProjectFile(file)
      return !text.includes('-f "bump=${RELEASE_INPUT}"')
    })

    // then
    expect(missingExplicitVersionDispatch).toEqual([])
    expect(missingBumpDispatch).toEqual([])
  })

  test("#given publish runbooks #when workflow ownership is inspected #then they use the exact dispatch run id", () => {
    // given
    const files = publishRunbookFiles

    // when
    const missingExactRunOwnership = files.filter((file) => {
      const text = readProjectFile(file)
      return !text.includes('RUN_URL="$(gh workflow run') ||
        !text.includes('RUN_ID="${RUN_URL##*/}"') ||
        !text.includes('gh run view "${RUN_ID}"') ||
        text.includes("gh run list --workflow=publish --limit=1")
    })

    // then
    expect(missingExactRunOwnership).toEqual([])
  })

  test("#given publish runbooks #when inspected #then they verify npm opencode and codex release surfaces", () => {
    // given
    const files = publishRunbookFiles

    // when
    const missingReleaseSurfaces = files.flatMap((file) => {
      const text = normalizedText(file)
      return [
        "oh-my-opencode",
        "oh-my-openagent",
        "lazycodex-ai",
        "code-yeongyu/lazycodex",
      ]
        .filter((surface) => !text.includes(surface))
        .map((surface) => `${file}: ${surface}`)
    })
    const missingVersionStamping = files.filter((file) => !normalizedText(file).includes("codex plugin metadata"))

    // then
    expect(missingReleaseSurfaces).toEqual([])
    expect(missingVersionStamping).toEqual([])
  })
})
