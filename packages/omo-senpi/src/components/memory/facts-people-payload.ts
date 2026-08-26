import { readFile, readdir } from "node:fs/promises"
import { join } from "node:path"

import { parseMemoryFile, type FactsKnownPerson } from "@oh-my-opencode/memory-core"

export async function readFactsPeoplePayload(repoDir: string): Promise<{
  readonly knownPeople: readonly FactsKnownPerson[]
  readonly primaryHuman: { readonly slug: "human"; readonly aliases: readonly string[] }
}> {
  const human = await readCard(join(repoDir, "system", "human.md"))
  const peopleDir = join(repoDir, "people")
  const slugs = await readdir(peopleDir, { withFileTypes: true }).catch(() => [])
  const knownPeople: FactsKnownPerson[] = []
  for (const entry of slugs) {
    if (!entry.isDirectory() || entry.name === "human") continue
    const card = await readCard(join(peopleDir, entry.name, "card.md"))
    if (card === undefined) continue
    knownPeople.push({
      slug: entry.name,
      displayName: card.description.replace(/^Person\s*-\s*/i, "").trim() || entry.name,
      aliases: card.aliases,
    })
  }
  return {
    knownPeople: knownPeople.sort((left, right) => left.slug.localeCompare(right.slug)),
    primaryHuman: { slug: "human", aliases: human?.aliases ?? [] },
  }
}

async function readCard(path: string): Promise<{
  readonly description: string
  readonly aliases: readonly string[]
} | undefined> {
  const raw = await readFile(path, "utf8").catch(() => undefined)
  if (raw === undefined) return undefined
  try {
    const parsed = parseMemoryFile(raw)
    return {
      description: parsed.frontmatter.description,
      aliases: parsed.frontmatter.aliases ?? [],
    }
  } catch {
    return undefined
  }
}
