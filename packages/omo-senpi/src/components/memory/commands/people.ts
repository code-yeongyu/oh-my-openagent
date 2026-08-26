// /people [<name>] [--all] [--ask "<question>"]: roster, relationship graph, and
// dialectic-lite queries over the people records.
//
// The graph is DERIVED on every read from the `RELATIONSHIP: <predicate>: <target>`
// lines of `system/human.md` and `people/*/card.md`; it is never stored. Derivation
// is delegated to the palace collector so the panel and this command share one parser.
// Output is read-only and is pushed through the notify seam, never into model context.

import { readFile } from "node:fs/promises"
import { join } from "node:path"

import type { ObservationGroup, PeopleLimits } from "@oh-my-opencode/memory-core"

import type { SenpiExtensionAPI } from "../../../extension/types"
import { collectPeople, type PalacePeople, type PalacePeopleNode } from "../palace"
import { parseCommandArgs } from "./args"
import {
  parsePeopleCardLines,
  parsePeopleObservations,
  renderPersonCard,
  renderRoster,
} from "./people-render"
import {
  ABSTENTION_LINE,
  createPeopleAskRunner,
  hasNoEvidence,
  type PeopleAskEvidence,
} from "./people-ask"
import { resolvePersonQuery } from "./people-query"
import { collectPersonSearchHits } from "./people-search"
import { openRepo } from "./repo"
import {
  requireIdentity,
  respond,
  type MemoryCommandContext,
  type MemoryCommandDeps,
  type MemoryCommandIdentity,
} from "./types"

/** Fixed render budget per observation level; deliberately NOT a config knob. */
export const OBSERVATIONS_PER_LEVEL = 20

export { resolvePersonQuery, type PersonQueryResolution } from "./people-query"

/** Derives the roster and the adjacency graph from the person cards in the repository. */
export async function derivePeopleGraph(
  deps: MemoryCommandDeps,
  identity: MemoryCommandIdentity,
  limits: PeopleLimits,
): Promise<PalacePeople> {
  const repo = openRepo(deps, identity)
  const head = await repo.head()
  const people = await collectPeople(repo, head, { enabled: true, limits })
  return people ?? { nodes: [], edges: [], diagnostics: [] }
}

/** Newest-first per level, capped at OBSERVATIONS_PER_LEVEL unless `all` is set. */
export async function selectObservations(
  deps: MemoryCommandDeps,
  identity: MemoryCommandIdentity,
  slug: string,
  limits: PeopleLimits,
  options: { readonly all: boolean },
): Promise<readonly ObservationGroup[]> {
  const raw = await readPersonFile(deps, identity, `people/${slug}/observations.md`)
  if (raw === undefined) return []
  const groups = parsePeopleObservations(raw, limits)
  return groups.map((group) => {
    const sorted = [...group.entries].sort(byDateDescending)
    return { section: group.section, entries: options.all ? sorted : sorted.slice(0, OBSERVATIONS_PER_LEVEL) }
  })
}

export function registerPeopleCommand(pi: SenpiExtensionAPI, deps: MemoryCommandDeps): void {
  pi.registerCommand("people", {
    description: "Show the people roster and relationship graph, one person's record, or ask about them.",
    argumentHint: '[<name>] [--all] [--ask "<question>"]',
    handler: (args: string, ctx: MemoryCommandContext): Promise<string> => handlePeople(deps, args, ctx),
  })
}

async function handlePeople(deps: MemoryCommandDeps, args: string, ctx: MemoryCommandContext): Promise<string> {
  const identity = requireIdentity(deps, ctx)
  if (typeof identity === "string") return respond(ctx, identity, "error")

  const settings = deps.loadSettings()
  const people = settings.settings.people
  if (people?.enabled === false) return respond(ctx, "people records are disabled (memory.people.enabled)", "error")
  const limits: PeopleLimits = {
    maxEntries: people?.max_entries ?? 40,
    maxEntryChars: people?.max_entry_chars ?? 200,
  }

  const { question, rest } = extractAsk(args)
  const parsed = parseCommandArgs(rest, { booleans: ["all"] })
  const graph = await derivePeopleGraph(deps, identity, limits)
  const name = parsed.positionals.join(" ").trim()
  if (name.length === 0) return respond(ctx, renderRoster(graph))

  const resolved = resolvePersonQuery(graph.nodes, name)
  if (resolved.kind === "miss") {
    const close = resolved.close.length === 0 ? "no people records exist yet" : `closest slugs: ${resolved.close.join(", ")}`
    return respond(ctx, `no person matches "${name}"; ${close}`, "error")
  }

  const node = graph.nodes.find((candidate) => candidate.slug === resolved.slug)
  if (node === undefined) return respond(ctx, `no person matches "${name}"`, "error")
  // `--ask` reasons over the capped evidence set, so the `--all` widening is a render-only flag.
  const observations = await selectObservations(deps, identity, node.slug, limits, {
    all: question === undefined && parsed.flags.get("all") === true,
  })
  const cardBody = await readPersonFile(deps, identity, node.path)

  if (question !== undefined) {
    return respond(ctx, await askAboutPerson(deps, ctx, node, question, limits, cardBody, observations))
  }

  return respond(ctx, renderPersonCard(node, parsePeopleCardLines(cardBody, limits), observations, graph.edges))
}

async function askAboutPerson(
  deps: MemoryCommandDeps,
  ctx: MemoryCommandContext,
  node: PalacePeopleNode,
  question: string,
  limits: PeopleLimits,
  cardBody: string | undefined,
  observations: readonly ObservationGroup[],
): Promise<string> {
  const evidence: PeopleAskEvidence = {
    card: parsePeopleCardLines(cardBody, limits),
    observations: observations.flatMap((group) =>
      group.entries.map((entry) => `[${group.section}] ${entry.date} ${entry.content}`),
    ),
    searchHits: collectPersonSearchHits(deps, ctx, node),
  }
  if (hasNoEvidence(evidence)) return ABSTENTION_LINE

  // Without a resolved config the quick category still resolves from its built-in
  // definition; only a user's `categories.quick` pin would be missed.
  const runner =
    deps.peopleAsk ??
    createPeopleAskRunner({
      config: deps.loadSettings().config ?? {},
      registry: modelRegistryOf(ctx),
      ...(deps.env === undefined ? {} : { env: deps.env }),
    })
  return runner({ slug: node.slug, displayName: node.displayName, question, evidence })
}

async function readPersonFile(
  deps: MemoryCommandDeps,
  identity: MemoryCommandIdentity,
  path: string,
): Promise<string | undefined> {
  const working = await readFile(join(identity.identityPaths.repo, path), "utf8").catch(() => undefined)
  if (working !== undefined) return working
  const repo = openRepo(deps, identity)
  const head = await repo.head()
  if (head === null) return undefined
  return repo.show(head, path).catch(() => undefined)
}

/**
 * `--ask` carries a quoted sentence, which the shared whitespace parser would shred,
 * so its value is lifted out of the raw argument string before the rest is parsed.
 */
function extractAsk(args: string): { readonly question: string | undefined; readonly rest: string } {
  const match = args.match(/--ask(?:=|\s+)("[^"]*"|'[^']*'|\S+)/)
  if (match?.[1] === undefined) return { question: undefined, rest: args }
  const raw = match[1]
  const unquoted = /^(["']).*\1$/.test(raw) ? raw.slice(1, -1) : raw
  const question = unquoted.trim()
  const rest = `${args.slice(0, match.index)} ${args.slice((match.index ?? 0) + match[0].length)}`
  return { question: question.length === 0 ? undefined : question, rest }
}

function byDateDescending(left: { readonly date: string }, right: { readonly date: string }): number {
  return right.date.localeCompare(left.date)
}

function modelRegistryOf(ctx: MemoryCommandContext): Parameters<typeof createPeopleAskRunner>[0]["registry"] {
  const registry = ctx.modelRegistry
  return registry === undefined || registry === null
    ? undefined
    : (registry as Parameters<typeof createPeopleAskRunner>[0]["registry"])
}
