// Shared plumbing between the /memfs dispatcher and its subcommand handlers.

import type { GitMemoryRepo } from "@oh-my-opencode/memory-core"

import type { ParsedCommandArgs } from "./args"
import { hasGitRepo, openRepo } from "./repo"
import type { MemoryCommandContext, MemoryCommandDeps, MemoryCommandIdentity } from "./types"

export interface MemfsSubcommandInput {
  readonly deps: MemoryCommandDeps
  readonly ctx: MemoryCommandContext
  readonly parsed: ParsedCommandArgs
  readonly identity: MemoryCommandIdentity
}

export type MemfsSubcommand = (input: MemfsSubcommandInput) => Promise<string>

export function noRepoText(identity: MemoryCommandIdentity): string {
  return `no memory repository for ${identity.identity} at ${identity.identityPaths.repo}; run /memfs init first`
}

/** Returns the repo, or the actionable error text when the repository does not exist. */
export function requireExistingRepo(
  deps: MemoryCommandDeps,
  identity: MemoryCommandIdentity,
): GitMemoryRepo | string {
  if (!hasGitRepo(identity)) return noRepoText(identity)
  return openRepo(deps, identity)
}
