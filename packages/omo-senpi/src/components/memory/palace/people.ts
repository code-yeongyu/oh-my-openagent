// People-graph collector: nodes are person cards, edges are their `RELATIONSHIP:` lines.
// The graph is DERIVED on every read and never stored; card parsing is delegated to
// memory-core's people/format module so the palace and /people share one parser.

import { readFile, readdir, stat } from "node:fs/promises"
import { join } from "node:path"

import {
  parseMemoryFile,
  parsePeopleCard,
  type GitMemoryRepo,
  type PeopleLimits,
} from "@oh-my-opencode/memory-core"

import { UNCOMMITTED_LABEL, type PalaceEntryState } from "./collectors"

export const PRIMARY_HUMAN_SLUG = "human"
export const PRIMARY_HUMAN_CARD_PATH = "system/human.md"

const PEOPLE_PREFIX = "people/"
const CARD_SUFFIX = "/card.md"

export interface PalacePeopleNode {
  readonly slug: string
  readonly path: string
  readonly displayName: string
  readonly kind: string
  readonly aliases: readonly string[]
  readonly state: PalaceEntryState
}

export interface PalacePeopleEdge {
  readonly source: string
  readonly predicate: string
  readonly target: string
  readonly targetSlug: string | undefined
}

export interface PalacePeopleDiagnostic {
  readonly path: string
  readonly message: string
}

export interface PalacePeople {
  readonly nodes: readonly PalacePeopleNode[]
  readonly edges: readonly PalacePeopleEdge[]
  readonly diagnostics: readonly PalacePeopleDiagnostic[]
}

export interface PalacePeopleOptions {
  readonly enabled: boolean
  readonly limits: PeopleLimits
}

/**
 * Collects the people graph from committed HEAD plus working-tree cards.
 * Returns undefined when `people.enabled` is false, so the panel is absent rather than empty.
 */
export async function collectPeople(
  repo: GitMemoryRepo,
  head: string | null,
  options: PalacePeopleOptions,
): Promise<PalacePeople | undefined> {
  if (!options.enabled) return undefined

  const committed = head === null ? [] : (await repo.lsTree(head)).filter(isCardPath)
  const dirty = await dirtyPaths(repo)
  // `git status --porcelain` collapses an untracked directory to its directory entry, so a brand
  // new `people/<slug>/card.md` is enumerated from the working tree instead.
  const working = await workingCardPaths(repo.dir)
  const committedSet = new Set(committed)
  const paths = [...new Set([...committed, ...working])].sort(byPrimaryHumanFirst)

  const nodes: PalacePeopleNode[] = []
  const diagnostics: PalacePeopleDiagnostic[] = []
  const relationships: Array<{ source: string; predicate: string; target: string }> = []

  for (const path of paths) {
    const state: PalaceEntryState =
      dirty.has(path) || head === null || !committedSet.has(path) ? UNCOMMITTED_LABEL : "committed"
    const raw = await readCard(repo, head, path, state)
    if (raw === undefined) continue
    const file = parseFile(raw)
    if (file === undefined) {
      diagnostics.push({ path, message: "card frontmatter is unreadable" })
      continue
    }
    const slug = slugOf(path)
    const parsed = parsePeopleCard(file.body, options.limits)
    for (const message of parsed.diagnostics) diagnostics.push({ path, message })
    nodes.push({
      slug,
      path,
      displayName: displayNameOf(file.frontmatter.description, slug),
      kind: file.frontmatter.kind ?? "person",
      aliases: file.frontmatter.aliases ?? [],
      state,
    })
    for (const entry of parsed.card.entries) {
      if (entry.prefix !== "RELATIONSHIP") continue
      const edge = parseRelationship(slug, entry.content)
      if (edge === undefined) {
        diagnostics.push({ path, message: `RELATIONSHIP entry is not '<predicate>: <target>': ${entry.content}` })
        continue
      }
      relationships.push(edge)
    }
  }

  const known = new Set(nodes.map((node) => node.slug))
  const edges = relationships.map((edge) => ({
    source: edge.source,
    predicate: edge.predicate,
    target: edge.target,
    targetSlug: known.has(edge.target) ? edge.target : undefined,
  }))
  return { nodes, edges, diagnostics }
}

function parseRelationship(
  source: string,
  content: string,
): { source: string; predicate: string; target: string } | undefined {
  const separator = content.indexOf(":")
  if (separator <= 0) return undefined
  const predicate = content.slice(0, separator).trim()
  const target = content.slice(separator + 1).trim()
  if (predicate.length === 0 || target.length === 0) return undefined
  return { source, predicate, target }
}

async function readCard(
  repo: GitMemoryRepo,
  head: string | null,
  path: string,
  state: PalaceEntryState,
): Promise<string | undefined> {
  if (state === UNCOMMITTED_LABEL) {
    return readFile(join(repo.dir, path), "utf8").catch(() => undefined)
  }
  if (head === null) return undefined
  return repo.show(head, path).catch(() => undefined)
}

function parseFile(raw: string): ReturnType<typeof parseMemoryFile> | undefined {
  try {
    return parseMemoryFile(raw)
  } catch {
    return undefined
  }
}

async function dirtyPaths(repo: GitMemoryRepo): Promise<ReadonlySet<string>> {
  const porcelain = await repo.status().catch(() => "")
  const paths = new Set<string>()
  for (const line of porcelain.split(/\r?\n/)) {
    if (line.trim().length === 0) continue
    const path = line.slice(3).trim().replace(/^"(.*)"$/, "$1")
    if (path.length > 0) paths.add(path)
  }
  return paths
}

/** Working-tree card paths: `system/human.md` plus every `people/<slug>/card.md` that exists. */
async function workingCardPaths(repoDir: string): Promise<readonly string[]> {
  const paths: string[] = []
  const human = await stat(join(repoDir, PRIMARY_HUMAN_CARD_PATH)).catch(() => undefined)
  if (human?.isFile() === true) paths.push(PRIMARY_HUMAN_CARD_PATH)
  const slugs = await readdir(join(repoDir, "people"), { withFileTypes: true }).catch(() => [])
  for (const slug of slugs) {
    if (!slug.isDirectory()) continue
    const card = `${PEOPLE_PREFIX}${slug.name}${CARD_SUFFIX}`
    const info = await stat(join(repoDir, card)).catch(() => undefined)
    if (info?.isFile() === true) paths.push(card)
  }
  return paths
}

function isCardPath(path: string): boolean {
  if (path === PRIMARY_HUMAN_CARD_PATH) return true
  if (!path.startsWith(PEOPLE_PREFIX) || !path.endsWith(CARD_SUFFIX)) return false
  return slugOf(path).length > 0 && !slugOf(path).includes("/")
}

function slugOf(path: string): string {
  if (path === PRIMARY_HUMAN_CARD_PATH) return PRIMARY_HUMAN_SLUG
  return path.slice(PEOPLE_PREFIX.length, path.length - CARD_SUFFIX.length)
}

/** The primary human anchors the graph, so it sorts first; everyone else keeps path order. */
function byPrimaryHumanFirst(left: string, right: string): number {
  if (left === PRIMARY_HUMAN_CARD_PATH) return -1
  if (right === PRIMARY_HUMAN_CARD_PATH) return 1
  return left.localeCompare(right)
}

/** `description: Person - <Display Name>` (IC-14) carries the name; otherwise fall back to the slug. */
function displayNameOf(description: string, slug: string): string {
  const match = description.match(/^Person\s+-\s+(.+)$/)
  const name = match?.[1]?.trim()
  return name !== undefined && name.length > 0 ? name : slug
}
