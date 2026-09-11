/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"

const publishWorkflowPath = new URL("../.github/workflows/publish.yml", import.meta.url)
const canonicalCodexPromptPath = "packages/prompts-core/prompts/ultrawork/codex.md"

describe("LazyCodex prompts-core payload", () => {
  test("ships the canonical Codex prompt consumed by sync:skills", () => {
    // #given
    const workflow = readFileSync(publishWorkflowPath, "utf8")
    const publishLazycodexStep = workflow.slice(
      workflow.indexOf("name: Publish lazycodex-ai"),
      workflow.indexOf("name: Restore package.json after lazycodex-ai publish attempt"),
    )

    // #when
    const canonicalPromptIndex = publishLazycodexStep.indexOf(`"${canonicalCodexPromptPath}"`)

    // #then
    expect(canonicalPromptIndex).toBeGreaterThan(publishLazycodexStep.indexOf(".files = ["))
    expect(canonicalPromptIndex).toBeLessThan(
      publishLazycodexStep.indexOf('"!packages/omo-codex/plugin/node_modules"'),
    )
  })
})
