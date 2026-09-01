import { describe, expect, test } from "bun:test"
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs"
import { dirname, join, relative } from "node:path"

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

  test("#when source files are scanned #then consensus tool implementation traces are absent", () => {
    // given
    const forbiddenPaths = [
      "packages/omo-opencode/src/config/schema/consensus.ts",
      "packages/omo-opencode/src/features/consensus",
      "packages/omo-opencode/src/shared/model-lineage.ts",
      "packages/omo-opencode/src/tools/consensus",
    ]
    const forbiddenSnippets = [
      "createConsensusTool",
      "createConsensusToolsRecord",
      "buildConsensusSection",
      "<Consensus_Usage>",
      "consensusSection",
      "Consensus consultation",
      "ConsensusConfigSchema",
      "ConsensusToolResult",
      "multi-lineage voter panel",
      "runConsensus",
      "ConsensusToolArgs",
    ]

    // when
    const existingForbiddenPaths = forbiddenPaths.filter((path) => existsSync(join(REPO_ROOT, path)))
    const sourceHits = collectSourceFiles(join(REPO_ROOT, "packages", "omo-opencode", "src"))
      .filter((path) => !path.endsWith("consensus-removal.test.ts"))
      .flatMap((path) => {
        const content = readFileSync(path, "utf8")
        return forbiddenSnippets
          .filter((snippet) => content.includes(snippet))
          .map((snippet) => `${relative(REPO_ROOT, path)}:${snippet}`)
      })

    // then
    expect(existingForbiddenPaths).toEqual([])
    expect(sourceHits).toEqual([])
  })
})

function collectSourceFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const path = join(directory, entry)
    const stat = statSync(path)
    if (stat.isDirectory()) {
      return collectSourceFiles(path)
    }
    return path.endsWith(".ts") ? [path] : []
  })
}
