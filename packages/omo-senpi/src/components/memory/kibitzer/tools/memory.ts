import {
  RecallCorpusCache,
  selectRecallCandidates,
  type GitMemoryRepo,
  type RecallCorpus,
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

export interface KibitzerMemoryToolInput {
  /** Committed-only reads: every byte comes from HEAD through the recall corpus, never the working tree. */
  readonly repo: GitMemoryRepo
  readonly cache?: RecallCorpusCache
  readonly caps: KibitzerToolCaps
  readonly budget: () => WakeToolBudget
  /** Corpus-verified paths returned by `search`; the nudge tool accepts them for the sidecar's lifetime. */
  readonly searchedPaths: Set<string>
}

export interface KibitzerMemorySearchHit {
  readonly path: string
  readonly description: string
  readonly excerpt: string
}

export function createKibitzerMemoryTool(input: KibitzerMemoryToolInput): KibitzerSidecarTool<typeof KibitzerMemoryParams> {
  const cache = input.cache ?? new RecallCorpusCache()
  const corpus = (): Promise<RecallCorpus> => cache.load(input.repo)
  return {
    name: KIBITZER_MEMORY_TOOL_NAME,
    label: "Kibitzer memory",
    description: "Read-only access to committed memories: search by query or read one path. This tool cannot write.",
    parameters: KibitzerMemoryParams,
    execute: budgeted(input.budget, async (params: Static<typeof KibitzerMemoryParams>) => {
      switch (params.operation) {
        case "search":
          return search(params.query, await corpus(), input)
        case "read":
          return read(params.path, await corpus(), input.caps)
        default:
          return rejection("unsupported_operation", `Unsupported operation; use one of: ${MemoryToolOperations.join(", ")}.`)
      }
    }),
  }
}

function search(query: string | undefined, corpus: RecallCorpus, input: KibitzerMemoryToolInput) {
  if (query === undefined || query.trim().length === 0) return rejection("missing_argument", "search requires a non-empty query.")
  // One over the cap tells us whether the page is truncated without a second selection pass.
  const selected = selectRecallCandidates(corpus.documents, [query], { maxItems: input.caps.memorySearchResults + 1, surfaced: new Set() })
  const truncated = selected.length > input.caps.memorySearchResults
  const results: KibitzerMemorySearchHit[] = selected.slice(0, input.caps.memorySearchResults).map((candidate) => ({
    path: candidate.path,
    description: boundedText(candidate.description, input.caps.memoryReadChars),
    excerpt: boundedText(candidate.excerpt, input.caps.memoryReadChars),
  }))
  for (const hit of results) input.searchedPaths.add(hit.path)
  return okJson({ revision: corpus.revision, results, truncated })
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
