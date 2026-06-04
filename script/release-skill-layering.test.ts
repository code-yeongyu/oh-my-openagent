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
