import { afterEach } from "bun:test"
import { rm } from "node:fs/promises"

import { seededRepo, tempIdentity } from "./commands.test-support"
import type { MemoryCommandIdentity } from "./types"

export const tempDirs: string[] = []

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

export const LIMITS = { maxEntries: 40, maxEntryChars: 200 } as const

const HUMAN_CARD = [
  "---",
  "description: who the user is",
  "kind: person",
  'aliases: ["Boss"]',
  "---",
  "",
  "IDENTITY: the person you work with",
  "RELATIONSHIP: works-with: jane-doe",
  "RELATIONSHIP: mentors: sam-rivers",
  "",
].join("\n")

export const JANE_CARD = [
  "---",
  "description: Person - Jane Doe",
  "kind: person",
  'aliases: ["Jane","JD"]',
  "---",
  "",
  "IDENTITY: staff engineer",
  "ATTRIBUTE: prefers small diffs",
  "RELATIONSHIP: reports-to: human",
  "",
].join("\n")

const SAM_CARD = [
  "---",
  "description: Person - Sam Rivers",
  "kind: person",
  "---",
  "",
  "IDENTITY: designer",
  "RELATIONSHIP: collaborates: unknown-person",
  "",
].join("\n")

/** A person whose record holds nothing at all: no card entry, no observation ledger. */
const BLANK_CARD = ["---", "description: Person - Nia Blank", "kind: person", "---", ""].join("\n")

function observationsFile(count: number): string {
  const lines = ["---", "description: Observations - Jane Doe", "---", "", "## Explicit", ""]
  for (let index = 0; index < count; index += 1) {
    const day = String(index + 1).padStart(2, "0")
    lines.push(`- [2026-03-${day}] explicit note ${index + 1} <!-- src: s-${index + 1} -->`)
  }
  lines.push("", "## Inductive", "", "- [2026-01-05] tends to review in the morning <!-- pattern: cadence; confidence: low -->")
  return `${lines.join("\n")}\n`
}

export async function peopleFixture(observationCount = 0): Promise<MemoryCommandIdentity> {
  const { root, identity } = await tempIdentity()
  tempDirs.push(root)
  await seededRepo(identity, [
    { relativePath: "system/human.md", content: HUMAN_CARD },
    { relativePath: "people/jane-doe/card.md", content: JANE_CARD },
    { relativePath: "people/sam-rivers/card.md", content: SAM_CARD },
    { relativePath: "people/nia-blank/card.md", content: BLANK_CARD },
    ...(observationCount === 0
      ? []
      : [{ relativePath: "people/jane-doe/observations.md", content: observationsFile(observationCount) }]),
  ])
  return identity
}
