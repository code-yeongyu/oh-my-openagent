import { dirname } from "node:path"

import { lspClientKey } from "./client-key.js"
import { findWorkspaceRoot } from "./client-wrapper.js"
import { findServerForExtension } from "./server-resolution.js"
import type { ResolvedServer, ServerLookupResult } from "./types.js"

export type UnservedLookup = Exclude<ServerLookupResult, { status: "found" }>

/** Files of one directory scan that resolve to the same resident client (root, server id, command). */
export interface ServedFileGroup {
  readonly root: string
  readonly server: ResolvedServer
  readonly files: string[]
}

/** Files whose lookup found no usable server, grouped by that lookup outcome. */
export interface UnservedFileGroup {
  readonly lookup: UnservedLookup
  readonly files: string[]
}

export interface DirectoryServerGroups {
  readonly served: readonly ServedFileGroup[]
  readonly unserved: readonly UnservedFileGroup[]
}

export interface FixedDirectoryServer {
  readonly server?: ResolvedServer
  readonly workspaceRoot?: string
}

type DirectoryResolution =
  | { readonly kind: "served"; readonly key: string; readonly root: string; readonly server: ResolvedServer }
  | { readonly kind: "unserved"; readonly key: string; readonly lookup: UnservedLookup }

/**
 * Groups scanned files by the client a single-file request for each of them would use: the same
 * per-file lookup (findServerForExtension with the file's directory) and the same workspace root
 * (findWorkspaceRoot), keyed by lspClientKey. Lookups are cached per directory for one scan, so a
 * directory with many files is resolved once. `fixed` pins the server and root for every file.
 */
export function groupFilesByClient(
  files: readonly string[],
  extension: string,
  fixed: FixedDirectoryServer = {},
): DirectoryServerGroups {
  const byDirectory = new Map<string, DirectoryResolution>()
  const served = new Map<string, ServedFileGroup>()
  const unserved = new Map<string, UnservedFileGroup>()

  for (const file of files) {
    const directory = dirname(file)
    let resolution = byDirectory.get(directory)
    if (resolution === undefined) {
      resolution = resolveDirectory(directory, extension, fixed)
      byDirectory.set(directory, resolution)
    }
    if (resolution.kind === "served") {
      const group = served.get(resolution.key) ?? { root: resolution.root, server: resolution.server, files: [] }
      group.files.push(file)
      served.set(resolution.key, group)
    } else {
      const group = unserved.get(resolution.key) ?? { lookup: resolution.lookup, files: [] }
      group.files.push(file)
      unserved.set(resolution.key, group)
    }
  }

  return { served: [...served.values()], unserved: [...unserved.values()] }
}

function resolveDirectory(directory: string, extension: string, fixed: FixedDirectoryServer): DirectoryResolution {
  const lookup: ServerLookupResult =
    fixed.server === undefined
      ? findServerForExtension(extension, directory)
      : { status: "found", server: fixed.server }
  if (lookup.status !== "found") {
    const serverId = lookup.status === "not_installed" ? lookup.server.id : ""
    return { kind: "unserved", key: JSON.stringify([lookup.status, serverId]), lookup }
  }
  const root = fixed.workspaceRoot ?? findWorkspaceRoot(directory)
  return { kind: "served", key: lspClientKey(root, lookup.server), root, server: lookup.server }
}
