import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { SyncEntry } from "../../crypto/entry.ts"
import { vector, ACCOUNT } from "../../genesis/vector.test-support.ts"
import { disposeRecoveryKeys } from "../../recovery/derive.ts"
import { createAccountHttp } from "../http.ts"
import { createPairingHttp } from "../pairing-http.ts"
import { startChainWireServer } from "./chain-wire-server.test-support.ts"

export { ACCOUNT }

export const fixture = async () => {
  const v = await vector()
  const pinDir = await mkdtemp(join(tmpdir(), "genesis-enable-"))
  const entries: SyncEntry[] = []
  const server = startChainWireServer(ACCOUNT, entries, { requireConsent: true })
  const token = server.tokenFor(v.prepared.body.bootstrap.first_device, "service-first")
  let ceremonies = 0
  const options = { baseUrl: server.url, token: () => token }
  const input = {
    account: ACCOUNT, serviceDeviceId: "service-first", serviceOrigin: server.url,
    keyring: v.keyring, pinDir, chain: createAccountHttp(options), pairing: createPairingHttp(options),
    rpId: "recovery.omo.dev", userName: "synthetic-user", roaming: false,
    genesis: {
      prfSupported: true,
      createGenesis: async () => { ceremonies += 1; return { ok: true as const, prepared: v.prepared } },
    },
  }
  return {
    ...v, input, entries, server, options,
    ceremonies: () => ceremonies,
    async close() {
      disposeRecoveryKeys(v.recovery)
      await server.stop()
      await rm(pinDir, { recursive: true, force: true })
    },
  }
}

export const operationScope = () => {
  const controller = new AbortController()
  return {
    controller,
    operation: {
      authority: {
        signal: controller.signal,
        admit<T>(begin: () => T): T {
          controller.signal.throwIfAborted()
          return begin()
        },
      },
    },
  }
}
