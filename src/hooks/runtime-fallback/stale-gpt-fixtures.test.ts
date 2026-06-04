import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const staleGptFixturePattern = /gpt-5\.(?:2|3)|gpt-5-[23]|gpt-5[23]/i
const runtimeFallbackDir = dirname(fileURLToPath(import.meta.url))

const runtimeFallbackFixtureFiles = ["normalize-model.test.ts", "event-handler.test.ts"] as const

describe("runtime-fallback GPT fixture policy", () => {
  test("#given PR-touched runtime-fallback tests #when scanned #then stale GPT 5.2 and 5.3 fixtures are absent", async () => {
    // given
    const staleFixtures: string[] = []

    // when
    for (const fixtureFile of runtimeFallbackFixtureFiles) {
      const contents = readFileSync(join(runtimeFallbackDir, fixtureFile), "utf-8")
      if (staleGptFixturePattern.test(contents)) {
        staleFixtures.push(fixtureFile)
      }
    }

    // then
    expect(staleFixtures).toEqual([])
  })
})
