import { stat } from "node:fs/promises"
import * as shared from "./env-grants-store"
import { log } from "../logger"

export type EnvGrantLabel = shared.GrantLabel
export type EnvGrant = shared.Grant
export type EnvGrantSnapshot = shared.GrantSnapshot & {
  /** Observer metadata, never serialized into the grants file. */
  readonly revision?: string
}
export type EnvGrantObservation = {
  readonly snapshot: EnvGrantSnapshot
  readonly conservative: boolean
}
export interface GrantStore {
  read(): Promise<EnvGrantSnapshot>
  add(digest: string, grant: EnvGrant): Promise<void>
  revoke(digest: string): Promise<void>
  list(): Promise<Readonly<Record<string, EnvGrant>>>
  watch(listener: (event?: EnvGrantObservation) => void | Promise<void>): () => void
  digest(): Promise<string>
}

export function createFileGrantStore(configDir?: string): GrantStore {
  const path = shared.resolveGrantsStorePath(configDir)
  const read = async (): Promise<EnvGrantSnapshot> => {
    const snapshot = await shared.read(path)
    let revision = "missing"
    try {
      const info = await stat(path)
      revision = `${info.dev}:${info.ino}`
    } catch (error) { if (!(error instanceof Error)) throw error }
    return { ...snapshot, revision }
  }
  return {
    read,
    add: async (digest, grant) => { await shared.addGrant(path, digest, grant.label, grant.names) },
    revoke: async (digest) => { await shared.revoke(path, digest) },
    list: async () => (await read()).grants,
    digest: async () => shared.declarationDigest(await shared.read(path)),
    watch: (listener) => {
      let closed = false
      let stop: (() => void) | undefined
      void shared.observe(path, (event) => {
        if (!closed) void Promise.resolve(listener(event)).catch((error: unknown) => {
          log("[skill-mcp-env] grant listener failed", { error: error instanceof Error ? error.name : "unknown" })
        })
      }).then((unsubscribe) => {
        if (closed) unsubscribe()
        else stop = unsubscribe
      }).catch((error: unknown) => {
        log("[skill-mcp-env] grant observer failed", { error: error instanceof Error ? error.name : "unknown" })
      })
      return () => { closed = true; stop?.() }
    },
  }
}
