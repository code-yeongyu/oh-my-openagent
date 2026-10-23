// Memory identity resolution: named agent profiles plus a deterministic
// project-derived "auto" identity. Pure, except for one bounded filesystem
// probe: when a non-Latin identity's readable slug differs from the legacy
// ASCII-collapsed slug, the resolver keeps an already-existing legacy
// directory so upgraded installs never lose their memory.
//
// Every resolved id is "<safe-slug>-<sha256-8>" of the identity source
// (trimmed explicit value, or the normalized project root path for auto),
// so hostile inputs can never escape the layout root and two inputs that
// sanitize to the same slug still map to distinct directories.
//
// `resolveAutoIdentity` is the one entry point for the auto identity: with
// the opt-in `"git"` mode (`memory.auto_identity`), a linked git worktree's
// cwd is first mapped onto the main working tree (see ./git-layout), so every
// worktree of one clone resolves the main checkout's identity. Callers that
// honor that setting use it directly; `resolveMemoryIdentity` keeps the
// path-derived auto identity for an auto agent value.

import { createHash } from "node:crypto"
import { basename, join, resolve as resolvePath } from "node:path"
import { existsSync } from "../fs/resilient"
import { resolveLinkedWorktreeSource } from "./git-layout"
import { AGENTS_DIRNAME, buildIdentityPaths, resolveMemoryRoot, type MemoryIdentityPaths } from "./layout"

export const AUTO_AGENT_VALUE = "auto"
export const AUTO_IDENTITY_MODES = ["path", "git"] as const
export type AutoIdentityMode = (typeof AUTO_IDENTITY_MODES)[number]
export const FALLBACK_SLUG = "agent"
export const MAX_SLUG_LENGTH = 40
export const SHORT_HASH_LENGTH = 8

export interface MemoryIdentity {
  id: string
  safeSlug: string
  paths: MemoryIdentityPaths
}

export interface DirectoryProbe {
  readonly exists: (path: string) => boolean
}

const defaultDirectoryProbe: DirectoryProbe = { exists: existsSync }

interface SlugIdentity {
  readonly id: string
  readonly safeSlug: string
}

interface DerivedIdentity extends SlugIdentity {
  readonly legacy: SlugIdentity
}

export function shortHash(input: string): string {
  return createHash("sha256").update(input, "utf8").digest("hex").slice(0, SHORT_HASH_LENGTH)
}

function foldLatin(input: string): string {
  return input
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
}

export function sanitizeToSlug(input: string): string {
  const dashed = foldLatin(input)
    .replace(/[^\p{L}\p{M}\p{N}]+/gu, "-")
    .normalize("NFC")
  const collapsed = dashed.replace(/-{2,}/g, "-").replace(/^-+|-+$/g, "")
  const capped = Array.from(collapsed).slice(0, MAX_SLUG_LENGTH).join("").replace(/-+$/g, "")
  return capped === "" ? FALLBACK_SLUG : capped
}

// The pre-Unicode slugifier, kept verbatim so legacy directory ids stay derivable.
function legacySanitizeToSlug(input: string): string {
  const dashed = foldLatin(input).replace(/[^a-z0-9]+/g, "-")
  const collapsed = dashed.replace(/-{2,}/g, "-").replace(/^-+|-+$/g, "")
  const capped = collapsed.slice(0, MAX_SLUG_LENGTH).replace(/-+$/g, "")
  return capped === "" ? FALLBACK_SLUG : capped
}

export function isAutoAgentValue(configAgentValue: string | null | undefined): boolean {
  if (configAgentValue === null || configAgentValue === undefined) return true
  const trimmed = configAgentValue.trim()
  return trimmed === "" || trimmed === AUTO_AGENT_VALUE
}

function derive(hashSource: string, slugSource: string): DerivedIdentity {
  const hash = shortHash(hashSource)
  const safeSlug = sanitizeToSlug(slugSource)
  const legacySlug = legacySanitizeToSlug(slugSource)
  return {
    id: `${safeSlug}-${hash}`,
    safeSlug,
    legacy: { id: `${legacySlug}-${hash}`, safeSlug: legacySlug },
  }
}

function deriveAutoId(cwd: string, mode: AutoIdentityMode): DerivedIdentity {
  if (mode === "git") {
    const linked = resolveLinkedWorktreeSource(cwd)
    if (linked !== undefined) return derive(linked.hashSource, linked.slugSource)
  }
  const normalizedRoot = resolvePath(cwd)
  return derive(normalizedRoot, basename(normalizedRoot))
}

function deriveExplicitId(trimmedValue: string): DerivedIdentity {
  return derive(trimmedValue, trimmedValue)
}

function chooseDirectory(derived: DerivedIdentity, memoryRoot: string, probe: DirectoryProbe): SlugIdentity {
  if (derived.legacy.id === derived.id) return derived
  const agentsDir = join(memoryRoot, AGENTS_DIRNAME)
  if (probe.exists(join(agentsDir, derived.id))) return derived
  if (probe.exists(join(agentsDir, derived.legacy.id))) return derived.legacy
  return derived
}

function assertCwd(cwd: string, caller: string): void {
  if (typeof cwd !== "string" || cwd.trim() === "") {
    throw new TypeError(`${caller}: cwd must be a non-empty path string`)
  }
}

function toIdentity(
  derived: DerivedIdentity,
  cwd: string,
  env: Record<string, string | undefined>,
  probe: DirectoryProbe,
): MemoryIdentity {
  const memoryRoot = resolveMemoryRoot(env, cwd)
  const chosen = chooseDirectory(derived, memoryRoot, probe)
  return { id: chosen.id, safeSlug: chosen.safeSlug, paths: buildIdentityPaths(memoryRoot, chosen.id) }
}

export function resolveAutoIdentity(
  cwd: string,
  env: Record<string, string | undefined> = process.env,
  mode: AutoIdentityMode = "path",
  probe: DirectoryProbe = defaultDirectoryProbe,
): MemoryIdentity {
  assertCwd(cwd, "resolveAutoIdentity")
  return toIdentity(deriveAutoId(cwd, mode), cwd, env, probe)
}

export function resolveMemoryIdentity(
  configAgentValue: string | null | undefined,
  cwd: string,
  env: Record<string, string | undefined> = process.env,
  probe: DirectoryProbe = defaultDirectoryProbe,
): MemoryIdentity {
  assertCwd(cwd, "resolveMemoryIdentity")
  const trimmed = typeof configAgentValue === "string" ? configAgentValue.trim() : ""
  if (trimmed === "" || trimmed === AUTO_AGENT_VALUE) return resolveAutoIdentity(cwd, env, "path", probe)
  return toIdentity(deriveExplicitId(trimmed), cwd, env, probe)
}
