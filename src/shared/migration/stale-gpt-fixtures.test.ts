import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"

const PR_TOUCHED_FILES = [
  new URL("../../plugin-config.test.ts", import.meta.url),
  new URL("../migration.test.ts", import.meta.url),
  new URL("./model-versions.ts", import.meta.url),
] as const

type StaleHit = {
  readonly line: string
  readonly lineNumber: number
  readonly path: string
}

describe("migration GPT fixture policy", () => {
  test("#given PR-touched migration files #when scanned #then stale GPT 5.2 and 5.3 fixtures are absent", () => {
    // given
    const staleModelPattern = /gpt-5\.(?:2|3)(?:\b|-)/i

    // when
    const staleHits: StaleHit[] = PR_TOUCHED_FILES.flatMap((fileUrl): StaleHit[] => {
      const content = readFileSync(fileUrl, "utf-8")
      return content
        .split("\n")
        .map((line: string, index: number): StaleHit => ({ line, lineNumber: index + 1, path: fileUrl.pathname }))
        .filter((hit: StaleHit): boolean => staleModelPattern.test(hit.line))
    })

    // then
    expect(staleHits).toEqual([])
  })
})
