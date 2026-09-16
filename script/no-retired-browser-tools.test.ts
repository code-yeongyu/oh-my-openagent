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

test("ships no retired browser tool instructions", async () => {
  // Given: tracked sources plus the actual payloads produced by both owning generators.
  const cwd = resolve(import.meta.dir, "..")
  const patterns = ["agent-browser", "agent_browser", "npx playwright", "bunx playwright", "playwright install"]
  const tracked = Bun.spawnSync([
    "git", "ls-files", "-z", "--", ...trackedRoots,
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
  for (const file of [...files].sort()) {
    const content = readFileSync(join(cwd, file), "utf8")
    const lines = content.split(/\r?\n/)
    for (const [index, line] of lines.entries()) {
      if (!patterns.some((pattern) => line.includes(pattern))) continue
      violations.push(`${file}:${index + 1}:${line}`)
    }
  }

  // Then: every tracked source and materialized skill payload is covered, with no exemptions.
  expect(violations, `Retired browser tools remain at file:line:\n${violations.join("\n")}`).toEqual([])
})
