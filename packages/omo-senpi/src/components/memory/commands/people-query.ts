// Name resolution for `/people <name>`: exact slug, then alias or display name,
// then a bounded "did you mean" list so a miss stays actionable.

import type { PalacePeopleNode } from "../palace"

const MAX_CLOSE_SLUGS = 5
const MIN_SHARED_PREFIX = 3

export type PersonQueryResolution =
  | { readonly kind: "hit"; readonly slug: string }
  | { readonly kind: "miss"; readonly close: readonly string[] }

export function resolvePersonQuery(
  nodes: readonly PalacePeopleNode[],
  query: string,
): PersonQueryResolution {
  const needle = query.trim().toLowerCase()
  if (needle.length === 0) return { kind: "miss", close: nodes.map((node) => node.slug) }

  const exact = nodes.find((node) => node.slug.toLowerCase() === needle)
  if (exact !== undefined) return { kind: "hit", slug: exact.slug }

  const named = nodes.find(
    (node) =>
      node.displayName.toLowerCase() === needle ||
      node.aliases.some((alias) => alias.toLowerCase() === needle),
  )
  if (named !== undefined) return { kind: "hit", slug: named.slug }

  return { kind: "miss", close: closeSlugs(nodes, needle) }
}

/** Substring first, then a shared-prefix fallback, so a typo still lands near its target. */
function closeSlugs(nodes: readonly PalacePeopleNode[], needle: string): readonly string[] {
  const collapsed = collapse(needle)
  return nodes
    .map((node) => ({ slug: node.slug, score: closeness(node, needle, collapsed) }))
    .filter((candidate) => candidate.score > 0)
    .sort((left, right) => right.score - left.score || left.slug.localeCompare(right.slug))
    .slice(0, MAX_CLOSE_SLUGS)
    .map((candidate) => candidate.slug)
}

function closeness(node: PalacePeopleNode, needle: string, collapsed: string): number {
  const slug = node.slug.toLowerCase()
  const flat = collapse(slug)
  if (slug.includes(needle) || needle.includes(slug)) return 3
  if (flat.includes(collapsed) || collapsed.includes(flat)) return 3
  const shared = sharedPrefix(flat, collapsed)
  return shared >= MIN_SHARED_PREFIX ? 1 + shared / Math.max(flat.length, collapsed.length) : 0
}

function collapse(value: string): string {
  return value.replace(/[^a-z0-9]+/g, "")
}

function sharedPrefix(left: string, right: string): number {
  let index = 0
  while (index < left.length && index < right.length && left[index] === right[index]) index += 1
  return index
}
