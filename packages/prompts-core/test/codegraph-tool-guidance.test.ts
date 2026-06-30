import { describe, expect, test } from "bun:test"
import { readFile } from "node:fs/promises"

const GUIDANCE_FILES = [
  "packages/prompts-core/prompts/ultrawork/planner.md",
  "packages/prompts-core/prompts/ultrawork/gpt.md",
  "packages/prompts-core/prompts/ultrawork/gemini.md",
  "packages/prompts-core/prompts/ultrawork/default.md",
  "packages/prompts-core/prompts/ultrawork/codex.md",
  "packages/prompts-core/prompts/atlas/default.md",
  "packages/prompts-core/prompts/atlas/gpt.md",
  "packages/prompts-core/prompts/atlas/gemini.md",
  "packages/prompts-core/prompts/atlas/kimi.md",
  "packages/prompts-core/prompts/atlas/kimi-k2-7.md",
  "packages/prompts-core/prompts/atlas/opus-4-7.md",
  "packages/prompts-core/prompts/atlas/glm.md",
  "packages/shared-skills/skills/ulw-plan/SKILL.md",
  "packages/shared-skills/skills/init-deep/SKILL.md",
  "packages/omo-codex/plugin/components/ultrawork/directive.md",
  "packages/omo-codex/plugin/components/ultrawork/skills/ulw-plan/SKILL.md",
  "packages/omo-codex/plugin/components/ulw-loop/directive.md",
  "packages/omo-codex/plugin/skills/ulw-plan/SKILL.md",
  "packages/omo-codex/plugin/skills/init-deep/SKILL.md",
] as const

const REQUIRED_GUIDANCE = [
  /exact CodeGraph tool\s+names?\s+shown/,
  /codegraph_codegraph_explore/,
  /mcp__codegraph__codegraph_explore/,
  /bare `codegraph_explore`/,
] as const

describe("CodeGraph tool guidance", () => {
  test("#given source prompts and installed skill guidance #when CodeGraph guidance is inspected #then it names harness-exposed tools", async () => {
    const offenders: string[] = []

    for (const filePath of GUIDANCE_FILES) {
      const contents = await readFile(filePath, "utf8")
      const missing = REQUIRED_GUIDANCE.filter((guidance) => !guidance.test(contents))
      if (missing.length > 0) {
        offenders.push(`${filePath} missing: ${missing.map(String).join(", ")}`)
      }
    }

    expect(offenders).toEqual([])
  })
})
