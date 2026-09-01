// Memory identity resolution: named agent profiles plus a deterministic
// project-derived "auto" identity. Pure; no filesystem access.
//
// Every resolved id is "<safe-slug>-<sha256-8>" of the identity source
// (trimmed explicit value, or the normalized project root path for auto),
// so hostile inputs can never escape the layout root and two inputs that
// sanitize to the same slug still map to distinct directories.

import { createHash } from "node:crypto"
import { basename, resolve as resolvePath } from "node:path"
import { buildIdentityPaths, resolveMemoryRoot, type MemoryIdentityPaths } from "./layout"

export const AUTO_AGENT_VALUE = "auto"
export const FALLBACK_SLUG = "agent"
export const MAX_SLUG_LENGTH = 40
export const SHORT_HASH_LENGTH = 8

export interface MemoryIdentity {
  id: string
  safeSlug: string
  paths: MemoryIdentityPaths
}

export function shortHash(input: string): string {
  return createHash("sha256").update(input, "utf8").digest("hex").slice(0, SHORT_HASH_LENGTH)
}

export function sanitizeToSlug(input: string): string {
  const folded = input
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
  const dashed = folded.replace(/[^a-z0-9]+/g, "-")
  const collapsed = dashed.replace(/-{2,}/g, "-").replace(/^-+|-+$/g, "")
  const capped = collapsed.slice(0, MAX_SLUG_LENGTH).replace(/-+$/g, "")
  return capped === "" ? FALLBACK_SLUG : capped
}

export function isAutoAgentValue(configAgentValue: string | null | undefined): boolean {
  if (configAgentValue === null || configAgentValue === undefined) return true
  const trimmed = configAgentValue.trim()
  return trimmed === "" || trimmed === AUTO_AGENT_VALUE
}

function deriveAutoId(cwd: string): { id: string; safeSlug: string } {
  const normalizedRoot = resolvePath(cwd)
  const safeSlug = sanitizeToSlug(basename(normalizedRoot))
  return { id: `${safeSlug}-${shortHash(normalizedRoot)}`, safeSlug }
}

function deriveExplicitId(trimmedValue: string): { id: string; safeSlug: string } {
  const safeSlug = sanitizeToSlug(trimmedValue)
  return { id: `${safeSlug}-${shortHash(trimmedValue)}`, safeSlug }
}

export function resolveMemoryIdentity(
  configAgentValue: string | null | undefined,
  cwd: string,
  env: Record<string, string | undefined> = process.env,
): MemoryIdentity {
  if (typeof cwd !== "string" || cwd.trim() === "") {
    throw new TypeError("resolveMemoryIdentity: cwd must be a non-empty path string")
  }
  const trimmed = typeof configAgentValue === "string" ? configAgentValue.trim() : ""
  const derived =
    trimmed === "" || trimmed === AUTO_AGENT_VALUE
      ? deriveAutoId(cwd)
      : deriveExplicitId(trimmed)
  const memoryRoot = resolveMemoryRoot(env, cwd)
  return { ...derived, paths: buildIdentityPaths(memoryRoot, derived.id) }
}
