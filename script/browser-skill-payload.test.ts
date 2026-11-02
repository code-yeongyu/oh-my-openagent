import { expect, test } from "bun:test"
import { existsSync, readFileSync } from "node:fs"
import { join, relative, resolve, sep } from "node:path"
import { getSkillOutputManifest as senpiSkillManifest } from "../packages/omo-senpi/plugin/scripts/sync-skills.mjs"
import { getSkillOutputManifest as codexSkillManifest } from "../packages/omo-codex/plugin/scripts/sync-skills.mjs"

const SKILL_NAME = "browser"
const repoRoot = resolve(import.meta.dir, "..")
const sourceRoot = join(repoRoot, "packages", "shared-skills", "skills", SKILL_NAME)

function skillFiles(): readonly string[] {
  return [...new Bun.Glob("**/*").scanSync({ cwd: sourceRoot, dot: true, onlyFiles: true })].sort()
}

function frontmatterName(markdown: string): string | undefined {
  const match = markdown.match(/^---\r?\n([\s\S]*?)\r?\n---/)
  return match?.[1]?.match(/^name:\s*(.+?)\s*$/m)?.[1]?.replace(/^["']|["']$/g, "")
}

test("browser skill ships its source tree", () => {
  expect(existsSync(join(sourceRoot, "SKILL.md")), `${relative(repoRoot, sourceRoot)}/SKILL.md is absent`).toBe(true)
  expect(existsSync(join(sourceRoot, "ATTRIBUTION.md")), "upstream attribution is absent").toBe(true)
})

test("browser skill claims the name that cannot be shadowed by the upstream installer", () => {
  // Given: `bsk install-skill` writes upstream's own skill under the name `browser-skill` into the
  // harnesses it detects, and discoverAllSkills orders shared skills last while
  // deduplicateSkillsByName keeps the first match, so sharing that name means being shadowed.
  const name = frontmatterName(readFileSync(join(sourceRoot, "SKILL.md"), "utf8"))

  expect(name).toBe(SKILL_NAME)
})

test("browser skill reference docs declare no skill name", () => {
  // A reference doc that keeps a `name:` frontmatter is indistinguishable from a skill to the
  // loader, so the imported upstream presets must have theirs stripped.
  const offenders = skillFiles()
    .filter((file) => file.startsWith(`references${sep}`) && file.endsWith(".md"))
    .filter((file) => frontmatterName(readFileSync(join(sourceRoot, file), "utf8")) !== undefined)

  expect(offenders, `reference docs still declare frontmatter name: ${offenders.join(", ")}`).toEqual([])
})

test("browser skill bundles no nested dependency tree", () => {
  // script/verify-omo-ai-payload.mjs rejects nested node_modules and caps the unpacked payload,
  // so the skill's own scripts must stay dependency-free.
  const nested = skillFiles().filter((file) => file.split(sep).includes("node_modules"))

  expect(nested, `skill tree carries vendored dependencies: ${nested.join(", ")}`).toEqual([])
})

test("browser skill is materialized into both shipped editions", async () => {
  const manifests = await Promise.all([senpiSkillManifest(), codexSkillManifest()])

  for (const { root, names } of manifests) {
    expect(names, `${relative(repoRoot, root)} manifest omits ${SKILL_NAME}`).toContain(SKILL_NAME)
    const skillFile = join(root, SKILL_NAME, "SKILL.md")
    expect(existsSync(skillFile), `${relative(repoRoot, skillFile)} is absent; run the edition's sync-skills.mjs`).toBe(true)
  }
})
