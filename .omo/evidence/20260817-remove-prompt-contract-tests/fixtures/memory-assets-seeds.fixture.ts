import { expect } from "bun:test"

const { sections, markdown } = loadReflectionPersona()
const phaseHeadings = sections.map((s) => s.heading).filter((h) => /^Phase \d+:/.test(h))
expect(phaseHeadings).toEqual([
  "Phase 1: Investigate",
  "Phase 2: Extract",
  "Phase 3: Update",
  "Phase 4: Review",
  "Phase 5: Commit",
])

const tokens = ["`update`:", "`extend`:", "`deprecate`:", "`split`:", "`create`:", "`none`:"]
const positions = tokens.map((t) => markdown.indexOf(t))
for (const pos of positions) expect(pos).toBeGreaterThan(-1)
for (let i = 1; i < positions.length; i++) {
  expect(positions[i]!).toBeGreaterThan(positions[i - 1]!)
}
expect(markdown.indexOf("when unsure between `create` and `none`, choose `none`")).toBeGreaterThan(
  positions[positions.length - 1]!,
)

const commitSection = sections.find((s) => s.heading === "Phase 5: Commit")!
const trailerKeys = [...commitSection.body.matchAll(/^([A-Z][A-Za-z-]+): .+$/gm)].map((m) => m[1]!)
expect(trailerKeys).toEqual(["Generated-By", "Agent-ID"])
const examples = commitSection.body
  .split("\n")
  .filter((line) => /^(feat|fix|chore)\(reflection\): /.test(line))
expect(examples.length).toBeGreaterThan(0)

const files = buildDefaultSeedFiles()
const skill = files.find((f) => f.relativePath === MEMORY_DISCIPLINE_SKILL_PATH)!
const parsed = parseMemoryFile(skill.content)
const triggerPhrase = "This skill should be used when"
expect(parsed.frontmatter.description.startsWith(triggerPhrase)).toBe(true)
expect(parsed.body.trim().length).toBeGreaterThan(0)

function loadReflectionPersona(): { sections: Array<{ heading: string; body: string }>; markdown: string } {
  throw new Error("fixture is parsed, not executed")
}
declare function buildDefaultSeedFiles(): Array<{ relativePath: string; content: string }>
declare function parseMemoryFile(content: string): {
  frontmatter: { description: string }
  body: string
}
declare const MEMORY_DISCIPLINE_SKILL_PATH: string
