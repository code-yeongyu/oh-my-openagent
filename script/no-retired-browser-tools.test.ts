import { expect, test } from "bun:test"
import { existsSync, readFileSync } from "node:fs"
import { join, relative, resolve, sep } from "node:path"
import { getSkillOutputManifest as senpiSkillManifest } from "../packages/omo-senpi/plugin/scripts/sync-skills.mjs"
import { getSkillOutputManifest as codexSkillManifest } from "../packages/omo-codex/plugin/scripts/sync-skills.mjs"

const trackedRoots = [
  "packages/shared-skills/skills",
  "packages/omo-senpi/skills",
  "packages/omo-codex/plugin/components",
  "packages/prompts-core/prompts",
  "docs",
  "packages/omo-opencode/src",
  "packages/skills-loader-core/src",
] as const

// TODO-12: only files implementing or testing the legacy browser-provider contract.
const providerFiles = [
  "packages/omo-opencode/src/agents/utils.test.ts",
  "packages/omo-opencode/src/config/schema.test.ts",
  "packages/omo-opencode/src/config/schema/agent-names.ts",
  "packages/omo-opencode/src/config/schema/browser-automation.ts",
  "packages/omo-opencode/src/features/opencode-skill-loader/skill-content.test.ts",
  "packages/omo-opencode/src/plugin/skill-context.test.ts",
  "packages/omo-opencode/src/plugin/skill-context.ts",
  "packages/omo-opencode/src/tools/delegate-task/tools.test.ts",
  "packages/omo-opencode/src/tools/skill/zauc-mocks-skill-tools/browser-provider.test.ts",
  "packages/skills-loader-core/src/types.ts",
  "packages/skills-loader-core/src/features/opencode-skill-loader/skill-discovery.ts",
  "packages/skills-loader-core/src/features/opencode-skill-loader/skill-content-browser-provider.test.ts",
  "packages/skills-loader-core/src/features/builtin-skills/agent-browser/SKILL.md",
  "packages/skills-loader-core/src/features/builtin-skills/skills.ts",
  "packages/skills-loader-core/src/features/builtin-skills/skills.test.ts",
  "packages/skills-loader-core/src/features/builtin-skills/skills/agent-browser-skill.ts",
  "packages/skills-loader-core/src/features/builtin-skills/skills/agent-browser-template.test.ts",
  "packages/skills-loader-core/src/features/builtin-skills/skills/agent-browser-template.ts",
  "packages/skills-loader-core/src/features/builtin-skills/skills/playwright.test.ts",
  "packages/skills-loader-core/src/features/builtin-skills/skills/playwright.ts",
] as const

test("ships no retired browser tool instructions outside the pending provider migration", async () => {
  // Given: tracked sources plus the actual payloads produced by both owning generators.
  const cwd = resolve(import.meta.dir, "..")
  const patterns = ["agent-browser", "agent_browser", "npx playwright", "bunx playwright", "playwright install"]
  const tracked = Bun.spawnSync([
    "git", "ls-files", "-z", "--", ...trackedRoots,
    ...providerFiles.map((path) => `:(exclude,literal)${path}`),
  ], { cwd, stdout: "pipe", stderr: "pipe" })
  expect(tracked.stderr.toString()).toBe("")
  expect(tracked.exitCode).toBe(0)
  const files = new Set(tracked.stdout.toString().split("\0").filter(Boolean))
  const manifests = await Promise.all([senpiSkillManifest(), codexSkillManifest()])

  for (const { root, names } of manifests) {
    const generator = relative(cwd, join(root, "..", "scripts", "sync-skills.mjs")).split(sep).join("/")
    for (const name of names) {
      const skillFile = join(root, name, "SKILL.md")
      expect(existsSync(skillFile), `${relative(cwd, skillFile)} is absent; run node ${generator} first`).toBe(true)
    }
    // Never sync here: it would erase a bad generated payload before inspecting it.
    for (const file of new Bun.Glob("**/*").scanSync({ cwd: root, dot: true, onlyFiles: true })) {
      files.add(relative(cwd, join(root, file)).split(sep).join("/"))
    }
  }

  // When: scan working-tree bytes, not the Git index, retaining file:line diagnostics.
  const violations: string[] = []
  let providerRows = 0
  for (const file of [...files].sort()) {
    const content = readFileSync(join(cwd, file), "utf8")
    const lines = content.split(/\r?\n/)
    for (const [index, line] of lines.entries()) {
      if (!patterns.some((pattern) => line.includes(pattern))) continue
      // TODO-12: only this provider's table row is reserved, never the whole document.
      if (file === "docs/reference/configuration.md" && /^\| `agent-browser`\s*\|/.test(line)) {
        providerRows += 1
      } else {
        violations.push(`${file}:${index + 1}:${line}`)
      }
    }
  }

  // Then: only one reserved row may match; ignored non-shipped files are not inputs.
  expect(providerRows).toBeLessThanOrEqual(1)
  expect(violations, `Retired browser tools remain at file:line:\n${violations.join("\n")}`).toEqual([])
})
