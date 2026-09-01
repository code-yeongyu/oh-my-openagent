/// <reference path="../../../../bun-test.d.ts" />
/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test"

const ACTIVE_SURFACE_EXTENSIONS = /\.(?:ts|mts|cts|mjs|js|json|jsonc|md|yaml|yml|toml)$/
const LEGACY_GPT_MODEL_RE = /gpt-5(?:\.|-)(?:2|3)(?![-\s]codex(?:\b|-|\.|_))(?:\b|-|\.|_)/i

const ALLOWED_LEGACY_REFERENCES = new Set([
  "packages/omo-opencode/src/generated/model-capabilities.generated.json",
])

function isActiveSurface(path: string): boolean {
  if (!ACTIVE_SURFACE_EXTENSIONS.test(path)) return false
  if (path.includes("/node_modules/")) return false
  if (path.includes("/dist/")) return false
  if (path.startsWith("packages/lsp-tools-mcp/")) return false
  if (path.includes("/__snapshots__/")) return false
  if (path.includes("work-with-pr-workspace/")) return false
  if (path.endsWith(".test.ts") || path.endsWith(".test.mts") || path.endsWith(".test.mjs")) return false
  if (path.endsWith(".snap")) return false
  if (ALLOWED_LEGACY_REFERENCES.has(path)) return false
  return true
}

describe("current model family references", () => {
  test("#given active repo surfaces #when scanned for legacy GPT models #then they use the GPT-5.5 family", async () => {
    // given
    const grepResult = Bun.spawnSync(["git", "grep", "-l", "-I", "-i", "-P", LEGACY_GPT_MODEL_RE.source, "--", "."], {
      stdout: "pipe",
      stderr: "pipe",
    })
    expect([0, 1]).toContain(grepResult.exitCode)

    // when
    const candidatePaths = grepResult.stdout
      .toString()
      .split("\n")
      .filter((path) => path.length > 0 && isActiveSurface(path))
    const offenders: string[] = []
    for (const path of candidatePaths) {
      if (!(await Bun.file(path).exists())) continue
      const text = await Bun.file(path).text()
      if (LEGACY_GPT_MODEL_RE.test(text)) offenders.push(path)
    }

    // then
    expect(offenders).toEqual([])
  })
})
