import type { ResolvedServer } from "./types.js"

/** What tells two resident clients apart: the server id and the exact command it was resolved to. */
export type ClientIdentity = Pick<ResolvedServer, "id" | "command">

/**
 * The resident client key. The resolved command is part of it because one server id can resolve to
 * different binaries under one workspace root: in a monorepo, a TypeScript 7 package is served by its
 * own `tsc --lsp` while a TypeScript 5 sibling is served by typescript-language-server. The same root
 * and command still share one client.
 */
export function lspClientKey(root: string, server: ClientIdentity): string {
  return JSON.stringify([root, server.id, server.command])
}
