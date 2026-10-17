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

// Guidance the senpi and codex editions ship to the model. The OpenCode edition keeps its own
// `browser_automation_engine` providers, so its sources are exempt from the omowright rule below.
const omowrightGuidanceRoots = [
  "packages/shared-skills/skills",
  "packages/omo-senpi/skills",
  "packages/omo-senpi/src/components/ultrawork",
  "packages/omo-codex/plugin/components",
  "packages/prompts-core/prompts/ultrawork",
] as const

test("ships no retired browser tool instructions", async () => {
  // Given: tracked sources plus the actual payloads produced by both owning generators.
  const cwd = resolve(import.meta.dir, "..")
  const patterns = ["agent-browser", "agent_browser", "npx playwright", "bunx playwright", "playwright install"]
  // Browser work in the senpi and codex editions ships through omowright (attached engine over
  // BrowserSkill, owned engine over CDP); the kernel WebView and hand-written playwright scripts it
  // replaced must not come back into the guidance those editions ship.
  const omowrightPatterns = ["playwright-core", "playwright-cli", "Bun.WebView", "launchPersistentContext", "chromium.launch"]
  const tracked = Bun.spawnSync([
    "git", "ls-files", "-z", "--", ...trackedRoots, ...omowrightGuidanceRoots,
  ], { cwd, stdout: "pipe", stderr: "pipe" })
  expect(tracked.stderr.toString()).toBe("")
  expect(tracked.exitCode).toBe(0)
  const files = new Set(tracked.stdout.toString().split("\0").filter(Boolean))
  const payloadFiles = new Set<string>()
  const manifests = await Promise.all([senpiSkillManifest(), codexSkillManifest()])

  for (const { root, names } of manifests) {
    const generator = relative(cwd, join(root, "..", "scripts", "sync-skills.mjs")).split(sep).join("/")
    for (const name of names) {
      const skillFile = join(root, name, "SKILL.md")
      expect(existsSync(skillFile), `${relative(cwd, skillFile)} is absent; run node ${generator} first`).toBe(true)
    }
    // Never sync here: it would erase a bad generated payload before inspecting it.
    for (const file of new Bun.Glob("**/*").scanSync({ cwd: root, dot: true, onlyFiles: true })) {
      const relativeFile = relative(cwd, join(root, file)).split(sep).join("/")
      files.add(relativeFile)
      payloadFiles.add(relativeFile)
    }
  }

  // Runtime code that a skill executes (the ultimate-browsing extraction engine and its Playwright
  // templates, the frontend perfection tooling that drives Lighthouse) is measured by its own tests;
  // the omowright rule covers the guidance the model reads, not those programs.
  const executableSkillCode = /\/(?:engine|scripts)\/.*\.(?:js|mjs|py|json)$|\/references\/perfection\//
  const underOmowrightRule = (file: string): boolean =>
    (payloadFiles.has(file) || omowrightGuidanceRoots.some((root) => file.startsWith(`${root}/`)))
    && !executableSkillCode.test(file)

  // When: scan working-tree bytes, not the Git index, retaining file:line diagnostics.
  const violations: string[] = []
  for (const file of [...files].sort()) {
    const content = readFileSync(join(cwd, file), "utf8")
    const lines = content.split(/\r?\n/)
    const active = underOmowrightRule(file) ? [...patterns, ...omowrightPatterns] : patterns
    for (const [index, line] of lines.entries()) {
      if (!active.some((pattern) => line.includes(pattern))) continue
      violations.push(`${file}:${index + 1}:${line}`)
    }
  }

  // Then: every tracked source and materialized skill payload is covered, with no exemptions.
  expect(violations, `Retired browser tools remain at file:line:\n${violations.join("\n")}`).toEqual([])
})
