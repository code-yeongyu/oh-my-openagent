// Text rendering for /people: the roster with its adjacency tree, and one
// person's card plus observations. Parsing is delegated to memory-core's people
// format module so every consumer shares one parser.

import { parseMemoryFile, parsePeopleCard, type ObservationGroup, type PeopleLimits } from "@oh-my-opencode/memory-core"

import type { PalacePeople, PalacePeopleEdge, PalacePeopleNode } from "../palace"

const TREE_BRANCH = "|-"
const TREE_LAST = "`-"

/** Card entry lines of a person file, formatted `PREFIX: content`. */
export function parsePeopleCardLines(raw: string | undefined, limits: PeopleLimits): readonly string[] {
  const body = fileBody(raw)
  if (body === undefined) return []
  return parsePeopleCard(body, limits).card.entries.map((entry) => `${entry.prefix}: ${entry.content}`)
}

/** Observation groups of a person ledger, in file order. */
export function parsePeopleObservations(raw: string | undefined, limits: PeopleLimits): readonly ObservationGroup[] {
  const body = fileBody(raw)
  if (body === undefined) return []
  return parsePeopleCard(body, limits).card.observations ?? []
}

export function renderRoster(graph: PalacePeople): string {
  if (graph.nodes.length === 0) {
    return "No people records yet. They accrue as facts about people are saved."
  }
  const lines = [`# People (${graph.nodes.length})`, ""]
  for (const node of graph.nodes) {
    lines.push(`${node.slug}  ${node.displayName}${node.aliases.length === 0 ? "" : ` (${node.aliases.join(", ")})`}`)
    const outgoing = graph.edges.filter((edge) => edge.source === node.slug)
    outgoing.forEach((edge, index) => {
      const marker = index === outgoing.length - 1 ? TREE_LAST : TREE_BRANCH
      const unknown = edge.targetSlug === undefined ? " (no card)" : ""
      lines.push(`  ${marker} ${edge.predicate} -> ${edge.target}${unknown}`)
    })
  }
  lines.push("", `${graph.edges.length} relationship${graph.edges.length === 1 ? "" : "s"} across ${graph.nodes.length} card${graph.nodes.length === 1 ? "" : "s"}.`)
  for (const diagnostic of graph.diagnostics) lines.push(`! ${diagnostic.path}: ${diagnostic.message}`)
  return lines.join("\n")
}

export function renderPersonCard(
  node: PalacePeopleNode,
  cardLines: readonly string[],
  observations: readonly ObservationGroup[],
  edges: readonly PalacePeopleEdge[],
): string {
  const lines = [
    `# ${node.displayName} (${node.slug})`,
    `kind: ${node.kind}${node.aliases.length === 0 ? "" : ` | aliases: ${node.aliases.join(", ")}`}`,
    `state: ${node.state} | path: ${node.path}`,
    "",
    "## Card",
    ...(cardLines.length === 0 ? ["(empty card)"] : cardLines),
  ]

  const related = edges.filter((edge) => edge.source === node.slug || edge.targetSlug === node.slug)
  if (related.length > 0) {
    lines.push("", "## Relationships")
    for (const edge of related) lines.push(`${edge.source} ${edge.predicate} -> ${edge.target}`)
  }

  lines.push("", "## Observations")
  if (observations.length === 0) {
    lines.push("(none recorded)")
    return lines.join("\n")
  }
  for (const group of observations) {
    lines.push("", `### ${group.section} (${group.entries.length})`)
    for (const entry of group.entries) lines.push(`- [${entry.date}] ${entry.content}${suffixOf(entry)}`)
  }
  return lines.join("\n")
}

function suffixOf(entry: ObservationGroup["entries"][number]): string {
  const parts: string[] = []
  if (entry.n !== undefined) parts.push(`n=${entry.n}`)
  if (entry.pattern !== undefined) parts.push(`pattern: ${entry.pattern}`)
  if (entry.confidence !== undefined) parts.push(`confidence: ${entry.confidence}`)
  if (entry.status !== undefined) parts.push(`status: ${entry.status}`)
  return parts.length === 0 ? "" : `  (${parts.join("; ")})`
}

/** People files carry frontmatter; an unreadable file yields no entries rather than throwing. */
function fileBody(raw: string | undefined): string | undefined {
  if (raw === undefined) return undefined
  try {
    return parseMemoryFile(raw).body
  } catch {
    return undefined
  }
}
