// Transcript evidence for `/people <name> --ask`: the same FTS-lite scan `/search`
// runs, narrowed to the person's name and aliases. Read-only; sessions are never
// mutated and the hits only ever reach the dialectic child as inline evidence.

import { existsSync } from "@oh-my-opencode/memory-core/fs"
import { join } from "node:path"

import { SenpiSessionProvider, searchTranscripts, searchableText } from "@oh-my-opencode/memory-core"

import type { PalacePeopleNode } from "../palace"
import type { MemoryCommandContext, MemoryCommandDeps } from "./types"

const MAX_HITS = 10
const SNIPPET_CHARS = 240

export function collectPersonSearchHits(
  deps: MemoryCommandDeps,
  ctx: MemoryCommandContext,
  node: PalacePeopleNode,
): readonly string[] {
  const sessionsDir = resolveSessionsDir(deps, ctx)
  if (sessionsDir === undefined || !existsSync(sessionsDir)) return []

  const needles = [node.displayName, ...node.aliases].map((needle) => needle.trim()).filter((needle) => needle.length > 0)
  if (needles.length === 0) return []

  const provider = new SenpiSessionProvider({ sessionsDir })
  const seen = new Set<string>()
  const hits: string[] = []
  for (const needle of needles) {
    for (const result of searchTranscripts(provider, `"${needle}"`, {})) {
      if (hits.length >= MAX_HITS) return hits
      if (seen.has(result.messageId)) continue
      seen.add(result.messageId)
      hits.push(`${result.createdAt} ${snippetOf(searchableText(result.document))}`)
    }
  }
  return hits
}

function snippetOf(text: string): string {
  const collapsed = text.replace(/\s+/g, " ").trim()
  return collapsed.length <= SNIPPET_CHARS ? collapsed : `${collapsed.slice(0, SNIPPET_CHARS)}...`
}

function resolveSessionsDir(deps: MemoryCommandDeps, ctx: MemoryCommandContext): string | undefined {
  const configured = deps.sessionsDir?.()
  if (configured !== undefined) return configured
  return ctx.agentDir === undefined ? undefined : join(ctx.agentDir, "sessions")
}
