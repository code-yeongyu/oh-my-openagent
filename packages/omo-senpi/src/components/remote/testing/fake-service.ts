import { fakeClock, type FakeClock } from "../../../../../device-service-core/test/local-api/conformance/fake-clock.ts"
import { cleanup, startModeOwner, startOwner } from "../../../../../device-service-core/test/local-api/support.ts"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createLiveThreadSurface } from "../../thread/live-surface"
import { createRemoteClient, type RemoteClient, type RemoteClientDeps } from "../client"
import { createLocalSessions } from "../local-sessions"
import type { RemoteFailure, RemoteSender } from "../types"

// The device service fakes (device-service-core's conformance owner and its failure modes) and the one clock both layers
// run on, for the remote module's conformance and deadline rows. They move to relay-daemon's shared
// `@sisyphuslabs/relay-daemon-local-api/testing` once relay-daemon#1142 is vendored; two import sites switch then: this
// file and conformance.test.ts's import of the conformance world.

export { fakeClock, startModeOwner, startOwner, type FakeClock }

const PERSON: RemoteSender = { kind: "person", uid: "user-1" }

// This device's operator endpoint as a test sees it unless it injects one: none runs. A client built without it would
// reach whatever socket the machine's own omo host names (OMO_RPC_SOCKET_PATH and its siblings), so the listing that
// reads this device's sessions (#13787) could block on a real host.
const NO_OPERATOR_ENDPOINT = join(tmpdir(), "omo-remote-tests-no-endpoint", "rpc.sock")
const noLocalHost: RemoteClientDeps["localSessions"] = async () =>
  createLocalSessions(async (connect) =>
    createLiveThreadSurface(undefined, {
      socket: NO_OPERATOR_ENDPOINT,
      env: {},
      statusAll: async () => undefined,
      registry: async () => [],
      connect,
    }),
  )

const clients: RemoteClient[] = []

export const clientOn = (
  stateDir: string,
  clock: FakeClock,
  sender: RemoteSender = PERSON,
  extra: Partial<RemoteClientDeps> = {},
): RemoteClient => {
  const client = createRemoteClient(sender, {
    version: "5.1.70",
    stateDir,
    timers: clock,
    localSessions: noLocalHost,
    ...extra,
  })
  clients.push(client)
  return client
}

export const closeClients = async (): Promise<void> => {
  for (const client of clients.splice(0)) client.close()
  await cleanup()
}

/** The failure a call settled with; a test that expected a failure and got a value fails here. */
export const failureOf = (outcome: { readonly kind: "ok" } | RemoteFailure): RemoteFailure => {
  if (outcome.kind !== "error") throw new Error(`expected a failure, got ${JSON.stringify(outcome)}`)
  return outcome
}
