import { describe, expect, test } from "bun:test"
import { existsSync, readFileSync } from "node:fs"
import { dirname, join } from "node:path"

import { OhMyOpenCodeConfigSchema } from "../config"

function __repoRootFrom(start: string): string {
  let dir = start
  for (;;) {
    if (existsSync(join(dir, "bun.lock")) || existsSync(join(dir, ".git"))) return dir
    const parent = dirname(dir)
    if (parent === dir) throw new Error("repo root sentinel not found")
    dir = parent
  }
}

const REPO_ROOT = __repoRootFrom(import.meta.dir)

describe("#given PR 4703 consensus removal", () => {
  test("#when the generated schema is inspected #then consensus is not exposed to users", () => {
    // given
    const schemaPath = join(REPO_ROOT, "assets", "oh-my-opencode.schema.json")
    const schemaContent = readFileSync(schemaPath, "utf8")

    // when
    const exposesConsensusConfig = schemaContent.includes('"consensus"')

    // then
    expect(exposesConsensusConfig).toBe(false)
  })

  test("#when the root config schema is inspected #then consensus is not configurable", () => {
    // given
    const shapeKeys = Object.keys(OhMyOpenCodeConfigSchema.shape)

    // when
    const hasConsensusConfig = shapeKeys.includes("consensus")

    // then
    expect(hasConsensusConfig).toBe(false)
  })
})
