import { describe, expect, test } from "bun:test"
import { createHash } from "node:crypto"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { ANALYZE_MESSAGE, HYPERPLAN_MESSAGE, SEARCH_MESSAGE, TEAM_MESSAGE } from "./constants"

type PromptBaseline = {
  readonly name: string
  readonly message: string
  readonly sha256: string
  readonly byteLength: number
}

type ShimBaseline = {
  readonly name: string
  readonly filePath: string
}

const MODE_PROMPT_BASELINES: readonly PromptBaseline[] = [
  {
    name: "search",
    message: SEARCH_MESSAGE,
    sha256: "aa38d1011edcf083394441321564330661868411ec13b575e5994812fae27f62",
    byteLength: 311,
  },
  {
    name: "analyze",
    message: ANALYZE_MESSAGE,
    sha256: "63f9de6f7afb67ab68bc4abcc7e78c8450a6ce556378a7a5d2b9061a3c519d7f",
    byteLength: 865,
  },
  {
    name: "team",
    message: TEAM_MESSAGE,
    sha256: "21fd4110835ce380e307cf29e132753b04a58758b86cfaaf5dda26e0e3193d69",
    byteLength: 614,
  },
  {
    name: "hyperplan",
    message: HYPERPLAN_MESSAGE,
    sha256: "cea6f378370c736909be99bd9a66a06db1e4819848336dd7951298e949270ced",
    byteLength: 1500,
  },
]

const KEYWORD_DETECTOR_DIR = dirname(fileURLToPath(import.meta.url))

const MODE_SHIMS: readonly ShimBaseline[] = [
  { name: "search", filePath: join(KEYWORD_DETECTOR_DIR, "search", "default.ts") },
  { name: "analyze", filePath: join(KEYWORD_DETECTOR_DIR, "analyze", "default.ts") },
  { name: "team", filePath: join(KEYWORD_DETECTOR_DIR, "team", "default.ts") },
  { name: "hyperplan", filePath: join(KEYWORD_DETECTOR_DIR, "hyperplan", "default.ts") },
]

describe("keyword-detector mode prompt baselines", () => {
  test("#given captured prompt baselines #then each mode message keeps the same bytes", () => {
    for (const baseline of MODE_PROMPT_BASELINES) {
      expect(hashPrompt(baseline.message), baseline.name).toBe(baseline.sha256)
      expect(Buffer.byteLength(baseline.message, "utf8"), baseline.name).toBe(baseline.byteLength)
    }
  })

  test("#given migrated mode shims #then each shim stays within the LOC ceiling", async () => {
    for (const shim of MODE_SHIMS) {
      const source = await Bun.file(shim.filePath).text()

      expect(countPureLoc(source), shim.name).toBeLessThanOrEqual(20)
    }
  })
})

function hashPrompt(prompt: string): string {
  return createHash("sha256").update(prompt, "utf8").digest("hex")
}

function countPureLoc(source: string): number {
  let pureLoc = 0
  let insideBlockComment = false

  for (const rawLine of source.split("\n")) {
    const line = rawLine.trim()
    if (line.length === 0) continue
    if (insideBlockComment) {
      insideBlockComment = !line.includes("*/")
      continue
    }
    if (line.startsWith("/*")) {
      insideBlockComment = !line.includes("*/")
      continue
    }
    if (line.startsWith("//")) continue
    pureLoc += 1
  }

  return pureLoc
}
