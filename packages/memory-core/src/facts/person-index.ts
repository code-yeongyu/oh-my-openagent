import { readFile, readdir } from "../fs/resilient"
import { join } from "node:path"

import { parseMemoryFile } from "../memfs"

export interface FactsPeopleIndexEntry {
  readonly slug: string
  readonly displayName: string
  readonly names: readonly string[]
}

export async function readFactsPeopleIndex(repoDir: string): Promise<FactsPeopleIndexEntry[]> {
  const index: FactsPeopleIndexEntry[] = []
  const human = await readCardFrontmatter(join(repoDir, "system", "human.md"))
  if (human !== undefined) {
    index.push({
      slug: "human",
      displayName: displayNameOf(human.description, "human"),
      names: namesOf(human, "human"),
    })
  }
  const entries = await readdir(join(repoDir, "people"), { withFileTypes: true }).catch(() => [])
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name === "human") continue
    const card = await readCardFrontmatter(join(repoDir, "people", entry.name, "card.md"))
    if (card === undefined) continue
    index.push({
      slug: entry.name,
      displayName: displayNameOf(card.description, entry.name),
      names: namesOf(card, entry.name),
    })
  }
  return index
}

async function readCardFrontmatter(
  path: string,
): Promise<{ readonly description: string; readonly aliases: readonly string[] } | undefined> {
  const raw = await readFile(path, "utf8").catch(() => undefined)
  if (raw === undefined) return undefined
  try {
    const parsed = parseMemoryFile(raw)
    return { description: parsed.frontmatter.description, aliases: parsed.frontmatter.aliases ?? [] }
  } catch {
    return undefined
  }
}

function namesOf(
  card: { readonly description: string; readonly aliases: readonly string[] },
  fallback: string,
): readonly string[] {
  return [displayNameOf(card.description, fallback), ...card.aliases]
}

function displayNameOf(description: string, fallback: string): string {
  return description.replace(/^Person\s*-\s*/i, "").trim() || fallback
}
