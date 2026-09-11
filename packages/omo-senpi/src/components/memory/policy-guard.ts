import { lstatSync, readdirSync, realpathSync } from "@oh-my-opencode/memory-core/fs"
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path"

import type { SenpiExtensionAPI } from "../../extension/types"
import type { MemoryIdentityContext } from "./context"
import { TRANSIENT_DIRNAME, isDurableIdentityRoot } from "./transient-identity"

// Structural mirror of the Senpi filesystem policy API (senpi branch feat/extension-fs-policy:
// pi.registerFilesystemPolicy(policy), deny-wins composition across policies, deniedRoots
// metadata surfaced by the runner). The capability is detected at runtime and these types stay
// local so omo-senpi keeps compiling against Senpi releases that predate the API.
export type FilesystemOperation = "read" | "enumerate" | "write"

export interface FilesystemPolicyRequest {
  operation: FilesystemOperation
  canonicalPath: string
  toolName: string
}

export type FilesystemPolicyDecision = { allow: true } | { allow: false; reason: string }

export interface FilesystemPolicy {
  check(request: Readonly<FilesystemPolicyRequest>): FilesystemPolicyDecision | Promise<FilesystemPolicyDecision>
  deniedRoots?: readonly string[]
}

interface FilesystemPolicyRegistration {
  registerFilesystemPolicy(policy: FilesystemPolicy): void
}

export function hasFilesystemPolicySupport(
  api: SenpiExtensionAPI,
): api is SenpiExtensionAPI & FilesystemPolicyRegistration {
  const candidate: { on: SenpiExtensionAPI["on"]; registerFilesystemPolicy?: unknown } = api
  return typeof candidate.registerFilesystemPolicy === "function"
}

export type MemoryPolicyRegistration =
  | { readonly status: "registered" }
  | { readonly status: "unbound" }
  | { readonly status: "unsupported" }

/**
 * Registers the hard cross-identity filesystem policy when the host exposes the Senpi
 * filesystem policy API.
 *
 * Registration happens once at binding time. Resume-conflict and unbound sessions register
 * nothing: without a bound identity there is no carve-out to anchor, and the policy must
 * never deny everything. Hosts without the capability keep the P28 soft guard (guard.ts
 * tool_call hook) as the sole enforcement layer.
 */
export function registerMemoryFilesystemPolicy(
  pi: SenpiExtensionAPI,
  context: MemoryIdentityContext | undefined,
): MemoryPolicyRegistration {
  if (context === undefined) return { status: "unbound" }
  if (!hasFilesystemPolicySupport(pi)) return { status: "unsupported" }
  pi.registerFilesystemPolicy(buildMemoryFilesystemPolicy(context))
  return { status: "registered" }
}

/**
 * The verdict is structural - "inside a memory area but outside your own root" - so it never
 * depends on which sibling directories happen to exist. Both areas are denied because a transient
 * run's own root lives under `transient-runs/` (transient-identity.ts) while durable memory stays
 * under `agents/`; for a durable run the two lexical roots collapse into one.
 *
 * `deniedRoots` is metadata only (Senpi: reserved for inherited process sandboxes) and lists the
 * durable sibling identities - the ones that own a `repo/` - so it cannot grow with the number of
 * one-shot runs the machine has executed (#7765).
 */
function buildMemoryFilesystemPolicy(context: MemoryIdentityContext): FilesystemPolicy {
  const ownRoot = resolve(context.identityPaths.root)
  const durableAgentsRoot = dirname(resolve(context.durableRoot))
  const ownRoots = stableRoots([ownRoot])
  const deniedAreas = stableRoots([dirname(ownRoot), durableAgentsRoot, join(dirname(durableAgentsRoot), TRANSIENT_DIRNAME)])
  const deniedRoots = durableForeignIdentityRoots(durableAgentsRoot, context.identity)

  return {
    deniedRoots,
    check(request: Readonly<FilesystemPolicyRequest>): FilesystemPolicyDecision {
      const target = resolve(request.canonicalPath)
      if (ownRoots.some((root) => isWithin(root, target))) return { allow: true }
      if (deniedAreas.some((root) => isWithin(root, target))) {
        return {
          allow: false,
          reason: `cross-identity memory access denied: ${request.operation} ${request.canonicalPath}`,
        }
      }
      return { allow: true }
    },
  }
}

function durableForeignIdentityRoots(agentsRoot: string, ownIdentity: string): string[] {
  try {
    const entries = readdirSync(agentsRoot, { withFileTypes: true })
    return stableRoots(
      entries
        .filter((entry) => entry.name !== ownIdentity)
        .map((entry) => join(agentsRoot, entry.name))
        .filter((root) => isDurableIdentityRoot(root)),
    )
  } catch (error) {
    if (isMissingPathError(error)) return []
    throw error
  }
}

// Root computation mirrors the P28 soft guard (guard.ts keeps its copy private): lexical roots
// plus canonicalization from the nearest existing ancestor so symlinked memory roots and not
// yet created identity dirs still line up with the host-canonicalized request paths.
function stableRoots(paths: readonly string[]): string[] {
  return uniquePaths(paths.flatMap((path) => [path, canonicalizeFromNearestExisting(path)]))
}

function canonicalizeFromNearestExisting(target: string): string | undefined {
  let candidate = target
  const missingSegments: string[] = []
  while (true) {
    try {
      lstatSync(candidate)
      return resolve(realpathSync(candidate), ...missingSegments.reverse())
    } catch (error) {
      if (!isMissingPathError(error)) return undefined
      const parent = dirname(candidate)
      if (parent === candidate) return undefined
      missingSegments.push(basename(candidate))
      candidate = parent
    }
  }
}

function uniquePaths(paths: readonly (string | undefined)[]): string[] {
  return [...new Set(paths.filter((path): path is string => path !== undefined).map((path) => resolve(path)))]
}

function isWithin(root: string, target: string): boolean {
  const rel = relative(root, target)
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel))
}

function isMissingPathError(error: unknown): boolean {
  if (!(error instanceof Error) || !("code" in error)) return false
  return error.code === "ENOENT" || error.code === "ENOTDIR"
}
