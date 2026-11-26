// Space resolution (sync-design §3): pick this device's binding key for the project, then
// honour the sticky `omo.sync.space` record. A recorded space id wins over a changed remote
// URL, and the new canonical URL is an alias the caller adds to the space's manifest
// (`aliasOfStoredSpace`). With no named profile and no remote, every device of the account
// binds to the one account default space (#13720). A repository whose `omo.sync.binding` holds
// the `local:` binding an older build minted, and whose recorded space is that binding's own
// space, moves to the default space; that local space only ever existed on this device, so no
// other device is stranded. The legacy space id is reported on every resolve (the binding is
// never rewritten), so a crash before the engine retires that space's journal cannot lose it.
// The git-backed store reads and writes the memory repo's LOCAL config only.

import { join } from "node:path"

import { memoryGitEnvironment } from "../../git/exec-environment"
import { AUTO_AGENT_VALUE } from "../../identity/resolve"
import type { BindingKey, Remote } from "./binding"
import { ACCOUNT_DEFAULT_BINDING, namedBinding, parseBinding, repoBinding, spaceIdForBinding } from "./binding"

export const SYNC_BINDING_CONFIG_KEY = "omo.sync.binding"
export const SYNC_SPACE_CONFIG_KEY = "omo.sync.space"

export interface SpaceConfigStore {
  get(key: string): string | null
  set(key: string, value: string): void
}

export interface SpaceResolution {
  readonly bindingKey: BindingKey
  readonly spaceId: string
  /** True when the binding computed now differs from the one the stored space id came from. */
  readonly aliasOfStoredSpace: boolean
  /**
   * The per-device `local:` space this repository synced before it moved to the account default
   * space, or null. Its journal (cursor, outbox, item docs) belongs to that space and is retired.
   */
  readonly legacySpaceId: string | null
  /** Config entries this call wrote; for tests and journals. */
  readonly wrote: { readonly space?: string }
}

export interface ResolveSpaceOptions {
  readonly profile?: string | null
  readonly remotes?: readonly Remote[]
}

export function resolveSpace(store: SpaceConfigStore, opts: ResolveSpaceOptions): SpaceResolution {
  const wrote: { space?: string } = {}
  let storedSpace = store.get(SYNC_SPACE_CONFIG_KEY)
  const profile = typeof opts.profile === "string" ? opts.profile.trim() : ""
  const computed: BindingKey =
    profile !== "" && profile !== AUTO_AGENT_VALUE
      ? namedBinding(opts.profile ?? "")
      : ((opts.remotes === undefined ? null : repoBinding(opts.remotes)) ?? ACCOUNT_DEFAULT_BINDING)
  const computedId = spaceIdForBinding(computed)
  const legacySpaceId = computed === ACCOUNT_DEFAULT_BINDING ? legacyLocalSpaceId(store) : null
  // The legacy local space is replaced only where it is still the recorded space, or where this
  // repository already moved; any other recorded space stays sticky.
  const movesToDefault = legacySpaceId !== null && (storedSpace === legacySpaceId || storedSpace === computedId)
  if (movesToDefault && storedSpace === legacySpaceId) storedSpace = null
  const aliasOfStoredSpace = storedSpace !== null && storedSpace !== computedId
  const spaceId = storedSpace ?? computedId
  if (storedSpace === null) {
    store.set(SYNC_SPACE_CONFIG_KEY, spaceId)
    wrote.space = spaceId
  }
  return {
    bindingKey: computed,
    spaceId,
    aliasOfStoredSpace,
    legacySpaceId: movesToDefault ? legacySpaceId : null,
    wrote,
  }
}

function legacyLocalSpaceId(store: SpaceConfigStore): string | null {
  const stored = store.get(SYNC_BINDING_CONFIG_KEY)
  return stored !== null && parseBinding(stored)?.kind === "local" ? spaceIdForBinding(stored) : null
}

export class GitSpaceConfig implements SpaceConfigStore {
  constructor(private readonly repoDir: string) {}
  get(key: string): string | null {
    const out = runGit(this.repoDir, ["config", "--local", "--get", key])
    return out === null ? null : out.trim()
  }
  set(key: string, value: string): void {
    const out = runGit(this.repoDir, ["config", "--local", key, value])
    if (out === null) throw new Error(`GitSpaceConfig: failed to write ${key}`)
  }
}

/**
 * True once the memory repository holds its first commit: `git init` and the first memory write have both finished, so
 * no other writer is still creating its config (#13486). Asked through `--git-dir`, so a half-created `.git` is never a
 * repository and git cannot fall through to a checkout above the memory root.
 */
export function repoHasCommit(repoDir: string): boolean {
  const r = Bun.spawnSync(
    ["git", "--git-dir", join(repoDir, ".git"), "rev-parse", "--verify", "--quiet", "HEAD^{commit}"],
    { env: memoryGitEnvironment(process.env) },
  )
  return r.exitCode === 0
}

export function listRemotes(repoDir: string): Remote[] {
  const out = runGit(repoDir, ["remote", "-v"])
  if (out === null) return []
  const byName = new Map<string, string>()
  for (const line of out.split("\n")) {
    const parts = line.trim().split(/\s+/)
    if (parts.length < 2) continue
    const [name, url] = parts
    if (name !== undefined && url !== undefined && !byName.has(name)) byName.set(name, url)
  }
  return [...byName.entries()].map(([name, url]) => ({ name, url }))
}

export function resolveSpaceInRepo(repoDir: string, opts: { readonly profile?: string | null }): SpaceResolution {
  return resolveSpace(new GitSpaceConfig(repoDir), { ...opts, remotes: listRemotes(repoDir) })
}

function runGit(dir: string, args: readonly string[]): string | null {
  // Never the inherited environment as is: a GIT_DIR / GIT_WORK_TREE the host exported would read and
  // write another repository's config and list its remotes instead of `dir`'s (#12354).
  const r = Bun.spawnSync(["git", "-C", dir, ...args], { env: memoryGitEnvironment(process.env) })
  if (r.exitCode !== 0) return null
  return r.stdout.toString()
}
