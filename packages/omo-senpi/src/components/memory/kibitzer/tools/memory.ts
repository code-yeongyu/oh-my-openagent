import {
  RecallCorpusCache,
  selectRecallCandidates,
  type GitMemoryRepo,
  type RecallCorpus,
  type RecallQueryExpansions,
} from "@oh-my-opencode/memory-core"
import { Type, type Static } from "typebox"

import type { WakeToolBudget } from "./budget"
import type { KibitzerToolCaps } from "./caps"
import { normalizeMemoryPath } from "./path-safety"
import { boundedText, budgeted, okJson, okText, rejection, type KibitzerSidecarTool } from "./result"

export const KIBITZER_MEMORY_TOOL_NAME = "memory"

/** The ONLY operations the sidecar's memory tool has. There is no write operation, by design. */
export const MemoryToolOperations = ["search", "read"] as const

export const KibitzerMemoryParams = Type.Object({
  operation: Type.Union([Type.Literal("search"), Type.Literal("read")], { description: "search: find committed memories by query. read: return one committed memory body." }),
  query: Type.Optional(Type.String({ description: "Search terms (double quotes group a phrase). Required by search." })),
  path: Type.Optional(Type.String({ description: "Memory path relative to the memory repo. Required by read." })),
}, { additionalProperties: false })

/** Bounds of the terms a search may add; the same as birkin-mnemosyne's `memory_search`. */
export const MEMORY_EXPANSION_BOUNDS = { terms: 16, termChars: 80, noteLineChars: 300 } as const

function expansionTerms(description: string) {
  return Type.Optional(Type.Array(Type.String({ minLength: 1, maxLength: MEMORY_EXPANSION_BOUNDS.termChars }), { maxItems: MEMORY_EXPANSION_BOUNDS.terms, description }))
}

/** The parameters when `memory.recall.query_expansion` is on: the same two operations, and a search may add terms. */
export const KibitzerMemoryExpansionParams = Type.Object({
  ...KibitzerMemoryParams.properties,
  synonyms: expansionTerms("search only: 4-8 close synonyms or other wordings of the query's key words, in the query's language; not words already in it."),
  keywords: expansionTerms("search only: 4-8 keywords for the topic in the user's other working language(s), e.g. English for a Korean query."),
  related: expansionTerms("search only: 4-8 looser terms a memory answering the question might contain (broader, narrower or associated)."),
  note_line: Type.Optional(Type.String({ maxLength: MEMORY_EXPANSION_BOUNDS.noteLineChars, description: "search only: one short sentence written like a line of a memory that would answer the question." })),
}, { additionalProperties: false })

const SEARCH_ONLY_DESCRIPTION = "Read-only access to committed memories: search by query or read one path. This tool cannot write."
const EXPANSION_DESCRIPTION = `${SEARCH_ONLY_DESCRIPTION} Search matches words, not meaning: when a memory may be worded differently from the query, also pass synonyms / keywords / related / note_line. Each of their terms counts for less than a word of the query, and a memory that holds every word of the query still ranks first.`

export interface KibitzerMemoryToolInput {
  /** Committed-only reads: every byte comes from HEAD through the recall corpus, never the working tree. */
  readonly repo: GitMemoryRepo
  readonly cache?: RecallCorpusCache
  readonly caps: KibitzerToolCaps
  readonly budget: () => WakeToolBudget
  /** Corpus-verified paths returned by `search`; the nudge tool accepts them for the sidecar's lifetime. */
  readonly searchedPaths: Set<string>
  /** `memory.recall.query_expansion`. Off, the tool has the two-field search it always had. */
  readonly queryExpansion?: boolean
}

export interface KibitzerMemorySearchHit {
  readonly path: string
  readonly description: string
  readonly excerpt: string
}

export function createKibitzerMemoryTool(
  input: KibitzerMemoryToolInput,
): KibitzerSidecarTool<typeof KibitzerMemoryParams | typeof KibitzerMemoryExpansionParams> {
  const queryExpansion = input.queryExpansion === true
  const cache = input.cache ?? new RecallCorpusCache()
  const corpus = (): Promise<RecallCorpus> => cache.load(input.repo)
  return {
    name: KIBITZER_MEMORY_TOOL_NAME,
    label: "Kibitzer memory",
    description: queryExpansion ? EXPANSION_DESCRIPTION : SEARCH_ONLY_DESCRIPTION,
    parameters: queryExpansion ? KibitzerMemoryExpansionParams : KibitzerMemoryParams,
    execute: budgeted(input.budget, async (params: Static<typeof KibitzerMemoryExpansionParams>) => {
      switch (params.operation) {
        case "search":
          return search(params.query, queryExpansion ? params : undefined, await corpus(), input)
        case "read":
          return read(params.path, await corpus(), input.caps)
        default:
          return rejection("unsupported_operation", `Unsupported operation; use one of: ${MemoryToolOperations.join(", ")}.`)
      }
    }),
  }
}

type ExpansionArguments = Pick<Static<typeof KibitzerMemoryExpansionParams>, "synonyms" | "keywords" | "related" | "note_line">

/** The added terms of one search, or the reason they are refused. The model wrote them, so the bounds are checked here. */
function readExpansions(params: ExpansionArguments): RecallQueryExpansions | string {
  for (const tier of ["synonyms", "keywords", "related"] as const) {
    const terms: unknown = params[tier]
    if (terms === undefined) continue
    if (!Array.isArray(terms)) return `${tier} is a list of terms.`
    if (terms.length > MEMORY_EXPANSION_BOUNDS.terms) return `${tier} takes at most ${MEMORY_EXPANSION_BOUNDS.terms} terms.`
    if (terms.some((term) => typeof term !== "string" || term.length === 0 || Array.from(term).length > MEMORY_EXPANSION_BOUNDS.termChars)) {
      return `every ${tier} term is text of 1-${MEMORY_EXPANSION_BOUNDS.termChars} characters.`
    }
  }
  const noteLine: unknown = params.note_line
  if (noteLine !== undefined && (typeof noteLine !== "string" || Array.from(noteLine).length > MEMORY_EXPANSION_BOUNDS.noteLineChars)) {
    return `note_line is text of at most ${MEMORY_EXPANSION_BOUNDS.noteLineChars} characters.`
  }
  return {
    ...(params.synonyms === undefined ? {} : { synonyms: params.synonyms }),
    ...(params.keywords === undefined ? {} : { keywords: params.keywords }),
    ...(params.related === undefined ? {} : { related: params.related }),
    ...(params.note_line === undefined ? {} : { noteLine: params.note_line }),
  }
}

function search(query: string | undefined, added: ExpansionArguments | undefined, corpus: RecallCorpus, input: KibitzerMemoryToolInput) {
  if (query === undefined || query.trim().length === 0) return rejection("missing_argument", "search requires a non-empty query.")
  const parsedExpansions = added === undefined ? undefined : readExpansions(added)
  const expansionFallback = typeof parsedExpansions === "string" ? parsedExpansions : undefined
  const expansions = typeof parsedExpansions === "string" ? undefined : parsedExpansions
  // Invalid added terms never lose plain lexical recall: report the fallback in the successful result
  // so the sidecar can correct its next search without turning this search into a miss.
  // One over the cap tells us whether the page is truncated without a second selection pass.
  const selected = selectRecallCandidates(corpus.documents, [query], {
    maxItems: input.caps.memorySearchResults + 1,
    surfaced: new Set(),
    ...(expansions === undefined ? {} : { expansions }),
  })
  const truncated = selected.length > input.caps.memorySearchResults
  const results: KibitzerMemorySearchHit[] = selected.slice(0, input.caps.memorySearchResults).map((candidate) => ({
    path: candidate.path,
    description: boundedText(candidate.description, input.caps.memoryReadChars),
    excerpt: boundedText(candidate.excerpt, input.caps.memoryReadChars),
  }))
  for (const hit of results) input.searchedPaths.add(hit.path)
  return okJson({ revision: corpus.revision, results, truncated, ...(expansionFallback === undefined ? {} : { expansion_fallback: expansionFallback }) })
}

function read(path: string | undefined, corpus: RecallCorpus, caps: KibitzerToolCaps) {
  if (path === undefined) return rejection("missing_argument", "read requires a path.")
  const normalized = normalizeMemoryPath(path)
  if (!normalized.ok) return rejection(normalized.code, normalized.message, path)
  const document = corpus.documents.find((candidate) => candidate.path === normalized.path)
  if (document === undefined) {
    return rejection("not_committed", `"${normalized.path}" is not a committed memory file at HEAD.`, normalized.path)
  }
  return okText(boundedText(`description: ${document.description}\n\n${document.body}`, caps.memoryReadChars))
}
