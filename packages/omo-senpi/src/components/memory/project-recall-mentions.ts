import type { RecallDocument } from "@oh-my-opencode/memory-core"

import { createTranscriptMentionIndex, type MentionDocument } from "./recall-transcript-mentions"

interface SourceAliases {
  readonly documents: readonly MentionDocument[]
  readonly qualified: ReadonlyMap<string, string>
}

export interface ProjectSourceMentions {
  /** Qualified `@project/` paths of the project notes whose file path the transcript already names. */
  excludedPaths(sessionId: string, entries: readonly unknown[], projectDocuments: readonly RecallDocument[]): Set<string>
}

// The model reads a project note at its file path (the project nudge and the recall notice both show
// that path), never at its `@project/<identity>/<path>` key, so a note it already read is found in the
// transcript by the file path. The alias list is kept per document array, which stays the same object
// while the touched projects and their revisions do, so the mention index keeps its per-entry cache.
export function createProjectSourceMentions(sourceFor: (sessionId: string, path: string) => string | undefined): ProjectSourceMentions {
  const index = createTranscriptMentionIndex()
  const aliases = new WeakMap<readonly RecallDocument[], SourceAliases>()

  function aliasesOf(sessionId: string, projectDocuments: readonly RecallDocument[]): SourceAliases {
    const cached = aliases.get(projectDocuments)
    if (cached !== undefined) return cached
    const qualified = new Map<string, string>()
    for (const document of projectDocuments) {
      const source = sourceFor(sessionId, document.path)
      if (source !== undefined) qualified.set(source, document.path)
    }
    const created = { documents: [...qualified.keys()].map((path) => ({ path })), qualified }
    aliases.set(projectDocuments, created)
    return created
  }

  return {
    excludedPaths(sessionId, entries, projectDocuments) {
      if (projectDocuments.length === 0) return new Set()
      const { documents, qualified } = aliasesOf(sessionId, projectDocuments)
      const read = index.excludedPaths({ sessionId, entries, documents })
      return new Set([...read].flatMap((source) => qualified.get(source) ?? []))
    },
  }
}
