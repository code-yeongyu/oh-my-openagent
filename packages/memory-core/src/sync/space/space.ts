// Space resolution (sync-design §3): pick this device's binding key for the project, then
// honour the sticky `omo.sync.space` record. A recorded space id wins over a changed remote
// URL, and the new canonical URL is an alias the caller adds to the space's manifest
// (`aliasOfStoredSpace`). `omo.sync.binding` persists the minted `local:` binding of a
// remote-less project, so restarts keep one space. The git-backed store reads and writes
// the memory repo's LOCAL config only.

import { AUTO_AGENT_VALUE } from "../../identity/resolve"
import type { BindingKey, Remote } from "./binding"
import { localBinding, mintLocalBinding, namedBinding, parseBinding, repoBinding, spaceIdForBinding } from "./binding"

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
  /** Config entries this call wrote; for tests and journals. */
  readonly wrote: { readonly binding?: string; readonly space?: string }
}

export interface ResolveSpaceOptions {
  readonly profile?: string | null
  readonly remotes?: readonly Remote[]
  readonly randomHex?: () => string
}

export function resolveSpace(store: SpaceConfigStore, opts: ResolveSpaceOptions): SpaceResolution {
  const wrote: { binding?: string; space?: string } = {}
  const storedSpace = store.get(SYNC_SPACE_CONFIG_KEY)
  const profile = typeof opts.profile === "string" ? opts.profile.trim() : ""
  let computed: BindingKey
  if (profile !== "" && profile !== AUTO_AGENT_VALUE) {
    computed = namedBinding(opts.profile ?? "")
  } else {
    const repo = opts.remotes === undefined ? null : repoBinding(opts.remotes)
    if (repo !== null) {
      computed = repo
    } else {
      const storedBinding = store.get(SYNC_BINDING_CONFIG_KEY)
      if (storedBinding !== null && parseBinding(storedBinding)?.kind === "local") {
        computed = storedBinding
      } else {
        computed = opts.randomHex === undefined ? mintLocalBinding() : localBinding(opts.randomHex())
        store.set(SYNC_BINDING_CONFIG_KEY, computed)
        wrote.binding = computed
      }
    }
  }
  const computedId = spaceIdForBinding(computed)
  const aliasOfStoredSpace = storedSpace !== null && storedSpace !== computedId
  const spaceId = storedSpace ?? computedId
  if (storedSpace === null) {
    store.set(SYNC_SPACE_CONFIG_KEY, spaceId)
    wrote.space = spaceId
  }
  return { bindingKey: computed, spaceId, aliasOfStoredSpace, wrote }
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

export function resolveSpaceInRepo(
  repoDir: string,
  opts: { readonly profile?: string | null; readonly randomHex?: () => string },
): SpaceResolution {
  return resolveSpace(new GitSpaceConfig(repoDir), { ...opts, remotes: listRemotes(repoDir) })
}

function runGit(dir: string, args: readonly string[]): string | null {
  const r = Bun.spawnSync(["git", "-C", dir, ...args])
  if (r.exitCode !== 0) return null
  return r.stdout.toString()
}
