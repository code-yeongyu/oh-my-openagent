import { describe, expect, test } from "bun:test"
import { readFile } from "node:fs/promises"
import { fileURLToPath } from "node:url"

import { LATEST_MODEL_BY_FAMILY } from "@oh-my-opencode/model-core/latest-models"

// Architecture contract (#10141): the newest model of each family is named once, in
// packages/model-core/src/latest-models.ts. A default, fallback rung, alias, gate or migration
// target that spells one of those ids as a literal would silently stay behind on the next bump,
// which is how the Claude default once stayed on Opus 4.8 after everything else moved to Opus 5.5.

const REPOSITORY_ROOT = fileURLToPath(new URL("..", import.meta.url))

// Files that name a model for what it is rather than as "the latest of its family".
const MODEL_IDENTITY_FILES = new Map<string, string>([
  ["packages/model-core/src/latest-models.ts", "the table itself"],
  ["packages/model-core/src/model-capability-heuristics.ts", "per-model capability family names"],
  ["packages/model-core/src/provider-model-id-transform.ts", "per-model provider spellings"],
  ["packages/omo-senpi/src/components/telemetry/model-vocabulary.ts", "every known id, old and new"],
  ["packages/omo-codex/src/install/managed-agent-model-defaults.ts", "models LazyCodex once bundled"],
  ["packages/utils/src/migration/agent-category.ts", "each known id's migration category"],
  ["packages/prompts-core/src/atlas-prompts.ts", "prompts written for one model"],
  ["packages/prompts-core/src/variant-resolver.ts", "prompts written for one model"],
  ["packages/omo-opencode/src/agents/gpt-prompt-identity.ts", "prompts written for one model"],
  ["packages/omo-opencode/src/agents/atlas/agent.ts", "prompts written for one model"],
  ["packages/omo-opencode/src/agents/sisyphus-agent-factory.ts", "prompts written for one model"],
  ["packages/omo-opencode/src/agents/sisyphus-junior/agent.ts", "prompts written for one model"],
  ["packages/omo-opencode/src/agents/sisyphus/claude-opus-5.ts", "prompts written for one model"],
])
const MODEL_IDENTITY_DIRECTORIES = ["packages/model-core/src/model-capabilities/"]

const TEST_SOURCE = /(?:\.test\.ts|\.test-support\.ts)$|\/(?:test|tests|__tests__|fixtures|__fixtures__|qa)\//

function latestModelLiteralPattern(ids: readonly string[]): RegExp {
  const alternatives = ids.map((id) => id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")
  return new RegExp(`(["'\`])(?:[A-Za-z][\\w.-]*/)?(?:${alternatives})\\1`, "g")
}

const LATEST_MODEL_LITERAL = latestModelLiteralPattern(Object.values(LATEST_MODEL_BY_FAMILY))

async function trackedSourceFiles(): Promise<string[]> {
  // :(glob) makes `**/` match zero directories too; the plain pathspec skipped every file directly under src/.
  const proc = Bun.spawn(["git", "ls-files", "-z", "--", ":(glob)packages/*/src/**/*.ts"], {
    cwd: REPOSITORY_ROOT,
    stdout: "pipe",
  })
  const output = await new Response(proc.stdout).text()
  expect(await proc.exited).toBe(0)
  return output.split("\0").filter((file) => file.length > 0 && !TEST_SOURCE.test(file))
}

function isModelIdentityFile(file: string): boolean {
  return MODEL_IDENTITY_FILES.has(file) || MODEL_IDENTITY_DIRECTORIES.some((dir) => file.startsWith(dir))
}

describe("latest model id audit", () => {
  test("#given a family id #when it is spelled bare, provider-prefixed or in any quote style #then the pattern flags it", () => {
    const pattern = latestModelLiteralPattern(["claude-opus-5-5", "gpt-6.1-sol"])

    expect(`model: "claude-opus-5-5"`.match(pattern)).toHaveLength(1)
    expect(`model: 'anthropic/claude-opus-5-5'`.match(pattern)).toHaveLength(1)
    expect("model: `chatgpt-subscription/gpt-6.1-sol`".match(pattern)).toHaveLength(1)
    expect(`model: "gpt-6.1-sol-fast"`.match(pattern)).toBeNull()
    expect(`model: "gpt-601-sol"`.match(pattern)).toBeNull()
    expect(`export { buildPrompt } from "./claude-opus-5-5"`.match(pattern)).toBeNull()
    expect("model: `anthropic/${LATEST_MODEL_BY_FAMILY.claudeOpus}`".match(pattern)).toBeNull()
  })

  test("#given shipped source #when scanning for a latest family id #then only model-identity files spell one", async () => {
    const files = await trackedSourceFiles()
    expect(files.length).toBeGreaterThan(100)
    // Architecture contract: files directly under a package's src/ are scanned too (a fallback-chain table lives there).
    expect(files).toContain("packages/model-core/src/category-model-requirements.ts")

    const offenders: string[] = []
    for (const file of files) {
      if (isModelIdentityFile(file)) continue
      const lines = (await readFile(`${REPOSITORY_ROOT}${file}`, "utf8")).split("\n")
      lines.forEach((line, index) => {
        const code = line.trimStart()
        if (code.startsWith("//") || code.startsWith("/*") || code.startsWith("*")) return
        if (line.match(LATEST_MODEL_LITERAL)) offenders.push(`${file}:${index + 1}: ${line.trim()}`)
      })
    }

    expect(offenders).toEqual([])
  }, 20_000)
})
