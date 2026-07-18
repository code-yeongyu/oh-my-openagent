/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test"
import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import type { Decision, MemoryRead, MetaGovernorInput, TokenPrediction } from "./types"

const MODULE_DIR = import.meta.dir
const PURE_LOC_LIMIT = 250

function pureLoc(path: string): number {
  return readFileSync(path, "utf8")
    .split("\n")
    .filter((line) => {
      const trimmed = line.trim()
      return trimmed.length > 0 && !trimmed.startsWith("//")
    }).length
}

describe("meta-governor type barrel", () => {
  test("keeps every meta-governor source file below the pure LOC ceiling", () => {
    // given
    const sourceFiles = readdirSync(MODULE_DIR)
      .filter((file) => file.endsWith(".ts"))
      .map((file) => join(MODULE_DIR, file))

    // when
    const oversizedFiles = sourceFiles.filter((file) => pureLoc(file) > PURE_LOC_LIMIT)

    // then
    expect(oversizedFiles).toEqual([])
  })

  test("exports the stable public type surface from one barrel", () => {
    // given
    type PublicSurface = {
      readonly decision: Decision
      readonly memoryRead: MemoryRead
      readonly tokenPrediction: TokenPrediction
      readonly input: MetaGovernorInput
    }

    // when
    const surfaceKeys = ["decision", "memoryRead", "tokenPrediction", "input"] satisfies readonly (keyof PublicSurface)[]

    // then
    expect(surfaceKeys).toHaveLength(4)
  })
})
