/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"

const repoRoot = new URL("../", import.meta.url)

const installDocs = [
  "README.md",
  "README.ko.md",
  "README.ja.md",
  "README.ru.md",
  "README.zh-cn.md",
  "docs/guide/installation.md",
  "docs/reference/cli.md",
  "packages/omo-codex/README.md",
  "packages/omo-codex/MARKETPLACE.md",
  "packages/omo-codex/plugin/components/comment-checker/README.md",
  "packages/omo-codex/plugin/components/lsp/README.md",
  "packages/omo-codex/plugin/components/rules/README.md",
  "packages/omo-codex/plugin/components/ultrawork/README.md",
  "packages/omo-codex/plugin/components/ulw-loop/README.md",
]

const UNQUALIFIED_OMO_INSTALL = /(^|[^\w@/-])bunx\s+omo\s+install\b/u

describe("LazyCodex install documentation", () => {
  test("uses the scoped package-backed command for Codex Light install surfaces", () => {
    for (const docPath of installDocs) {
      // #given
      const content = readFileSync(new URL(docPath, repoRoot), "utf8")

      // #then
      expect(content, `${docPath} must not point users at the broken unscoped lazycodex package`).not.toContain("bunx lazycodex install")
      expect(content, `${docPath} must not point users at the unrelated unscoped omo package`).not.toMatch(UNQUALIFIED_OMO_INSTALL)
    }
  })
})
