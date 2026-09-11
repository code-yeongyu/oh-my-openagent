import { realpath } from "@oh-my-opencode/memory-core/fs"
import { isAbsolute, relative, resolve, sep } from "node:path"

import type { KibitzerRejectionCode } from "./result"

export type PathCheck =
  | { readonly ok: true; readonly path: string }
  | { readonly ok: false; readonly code: KibitzerRejectionCode; readonly message: string }

const RESERVED_SYSTEM_TREE = "system/"

/**
 * Memory paths are repo-relative POSIX paths. The check is syntactic and fail-closed: anything
 * that is not a plain relative path made of ordinary segments is rejected before git is consulted,
 * and the reserved root `system/` tree is invisible to the sidecar (nested `x/system/` is ordinary).
 */
export function normalizeMemoryPath(input: string): PathCheck {
  if (input.trim().length === 0) return { ok: false, code: "path_empty", message: "A memory path is required." }
  if (input.includes("\\")) return { ok: false, code: "path_separator", message: "Memory paths use '/' separators." }
  if (input.startsWith("/")) return { ok: false, code: "path_absolute", message: "Memory paths are relative to the memory repo." }
  const segments = input.split("/").filter((segment) => segment.length > 0 && segment !== ".")
  if (segments.some((segment) => segment === "..")) {
    return { ok: false, code: "path_traversal", message: "Memory paths cannot contain '..' segments." }
  }
  if (segments.length === 0) return { ok: false, code: "path_empty", message: "A memory path is required." }
  const path = segments.join("/")
  if (path === "system" || path.startsWith(RESERVED_SYSTEM_TREE)) {
    return { ok: false, code: "system_path", message: "The system/ tree is not readable by the sidecar." }
  }
  return { ok: true, path }
}

/**
 * Workspace paths resolve to a real filesystem location that must stay inside the real workspace
 * root. Both sides go through realpath, so a symlink whose target lies outside the root is rejected
 * the same way `..` and absolute paths are. A path that does not exist yet resolves lexically.
 */
export async function resolveWorkspacePath(root: string, input: string): Promise<PathCheck> {
  const realRoot = await realpath(root)
  const lexical = resolve(realRoot, input)
  let target: string
  try {
    target = await realpath(lexical)
  } catch {
    target = lexical
  }
  const rel = relative(realRoot, target)
  if (rel === "" || (!rel.startsWith("..") && !isAbsolute(rel) && !rel.split(sep).includes(".."))) {
    return { ok: true, path: target }
  }
  return { ok: false, code: "path_escape", message: `"${input}" resolves outside the workspace.` }
}
