// Project-scoped recall (#10044). A child project's memory joins a session's recall under a
// qualified path, `@project/<identity-id>/<path>`: still a plain relative path for every path check
// (no leading slash, no '..'), never equal to a path of the session's own memory, and unique per
// identity, so ledgers and surfaced sets keep one key per note across identities.

import type { RecallDocument } from "./provider"

export const PROJECT_MEMORY_PATH_PREFIX = "@project/"

export function qualifyProjectDocuments(identityId: string, documents: readonly RecallDocument[]): RecallDocument[] {
  return documents.map((document) => ({ ...document, path: `${PROJECT_MEMORY_PATH_PREFIX}${identityId}/${document.path}` }))
}

export function parseProjectMemoryPath(path: string): { readonly identityId: string; readonly path: string } | undefined {
  if (!path.startsWith(PROJECT_MEMORY_PATH_PREFIX)) return undefined
  const rest = path.slice(PROJECT_MEMORY_PATH_PREFIX.length)
  const slash = rest.indexOf("/")
  if (slash <= 0 || slash === rest.length - 1) return undefined
  return { identityId: rest.slice(0, slash), path: rest.slice(slash + 1) }
}
