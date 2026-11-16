import { fakeClock, type FakeClock } from "../../../../../device-service-core/test/local-api/conformance/fake-clock.ts"
import { cleanup, startModeOwner, startOwner } from "../../../../../device-service-core/test/local-api/support.ts"
import { createRemoteClient, type RemoteClient, type RemoteClientDeps } from "../client"
import type { RemoteFailure, RemoteSender } from "../types"

// The device service fakes (device-service-core's conformance owner and its failure modes) and the one clock both layers
// run on, for the remote module's conformance and deadline rows. They move to relay-daemon's shared
// `@sisyphuslabs/relay-daemon-local-api/testing` once relay-daemon#1142 is vendored.

export { fakeClock, startModeOwner, startOwner, type FakeClock }

const PERSON: RemoteSender = { kind: "person", uid: "user-1" }

const clients: RemoteClient[] = []

export const clientOn = (
  stateDir: string,
  clock: FakeClock,
  sender: RemoteSender = PERSON,
  extra: Partial<RemoteClientDeps> = {},
): RemoteClient => {
  const client = createRemoteClient(sender, { version: "5.1.70", stateDir, timers: clock, ...extra })
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
