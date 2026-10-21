import type { OmoToolPermissionValue } from "@oh-my-opencode/omo-config-core"

/**
 * Session-scoped override map. Two stores live on the same instance so the
 * gate can express both flavours of `explicit user override`:
 *
 * 1. `userOverrides`: the user has flipped a single (tool, target-path) to
 *    a non-default value in this session. Set externally (a future
 *    interactive prompt, or a follow-up CLI). Wins above everything.
 * 2. `askDecisions`: the gate saw an `ask` for a (tool, target-path) in
 *    this session and the agent chose "accept once"; the next call for the
 *    same pair resolves to `allow` from the cache.
 *
 * Both stores are held in-process by the gate instance; the audit log is the
 * durable record. The cache exposes its own test-only `reset` helper so a
 * failing test does not leak entries into another test.
 */

export type PermissionGateKey = {
  sessionID: string
  tool: string
  targetPath: string | undefined
}

function keyOf({ sessionID, tool, targetPath }: PermissionGateKey): string {
  return `${sessionID}\u0000${tool}\u0000${targetPath ?? ""}`
}

export type SetUserOverrideInput = PermissionGateKey & { value: OmoToolPermissionValue }

export type SessionPermissionCache = ReturnType<typeof createSessionPermissionCache>

export function createSessionPermissionCache() {
  const userOverrides = new Map<string, OmoToolPermissionValue>()
  const askDecisions = new Map<string, true>()

  return {
    getUserOverride(key: PermissionGateKey): OmoToolPermissionValue | undefined {
      return userOverrides.get(keyOf(key))
    },
    setUserOverride(input: SetUserOverrideInput): void {
      const { value, ...key } = input
      // `deny` beats `allow`; refuse to overwrite a stored deny.
      const existing = userOverrides.get(keyOf(key))
      if (existing === "deny" && value !== "deny") return
      userOverrides.set(keyOf(key), value)
    },
    hasAskDecision(key: PermissionGateKey): boolean {
      return askDecisions.has(keyOf(key))
    },
    recordAskDecision(key: PermissionGateKey): void {
      askDecisions.set(keyOf(key), true)
    },
  }
}

let _singletonForTest: SessionPermissionCache | undefined

export function sharedSessionPermissionCache(): SessionPermissionCache {
  if (!_singletonForTest) {
    _singletonForTest = createSessionPermissionCache()
  }
  return _singletonForTest
}

export function resetSessionPermissionCacheForTesting(): void {
  _singletonForTest = undefined
}
