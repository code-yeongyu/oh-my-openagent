/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"

const publishRunbookFiles = [
  ".agents/skills/publish/SKILL.md",
  ".agents/command/publish.md",
  ".opencode/command/publish.md",
] as const

function readProjectFile(path: string): string {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8")
}

function normalizedRunbookBody(path: string): string {
  return readProjectFile(path).replace(/^---\n[\s\S]*?\n---\n+/, "").trim()
}

describe("release skill layering", () => {
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

})
