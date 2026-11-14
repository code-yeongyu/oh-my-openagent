import { createDeliveryConsumer, type ConsumerStart, type DeliveryConsumer } from "../consumer/consumer"
import type { DeliveryServicePort } from "../consumer/port"
import type { IntakeAdmission } from "../gateway/intake-admission"
import type { GatewayStore } from "../gateway/store"
import { engineDropsRetainedRecord } from "./engine-minimum"
import { runPendingSweep } from "./pending-sweep"

export type ConsumerStartInput = {
  readonly store: GatewayStore
  readonly agentDir: string
  readonly sessionsDirectory: string
  /** The device service's delivery protocol on its local API; absent, there is nothing to serve on. */
  readonly deliveries: (() => Promise<DeliveryServicePort | undefined>) | undefined
  readonly engineVersion: string | undefined
  readonly minimumEngine: string | null | undefined
  readonly wake: (durableId: string) => Promise<void>
  readonly sameDevice: () => boolean
  /** The consumer had a port and died (its start failed, or its serving connection ended): it may be started again. */
  readonly onDied?: () => void
  readonly log: (line: string) => void
  /** The serving connection ended: the consumer stopped and serves nothing until a new start. */
  readonly onClosed?: () => void
  /** The consumer, as soon as it exists: it may wake a session before its start has returned. */
  readonly onConsumer?: (consumer: DeliveryConsumer) => void
}

/**
 * The one delivery consumer of an engine process (#13037 design 5.4): it declares this agent directory to the device
 * service, then wakes every session whose intake rows wait on an admitted sender (the pending sweep, 5.4 step 6). On an
 * engine below the wake minimum (A8.1) it opens no connection and declares nothing. A start that fails closes its port,
 * reports itself dead and answers `undefined`: the caller starts it again later, so a device whose daemon comes up
 * after this engine (a refused declaration, a restart) keeps its remote wake.
 */
export type ServingConsumer = {
  readonly consumer: DeliveryConsumer
  /** The device service's answer to whether a device is admitted now (5.6), for a woken session's drain. */
  readonly admitIntake: (device: string) => Promise<IntakeAdmission>
  readonly close: () => void
}

export async function startDeliveryConsumer(input: ConsumerStartInput): Promise<ServingConsumer | undefined> {
  if (input.deliveries === undefined) return undefined
  const engineReady =
    input.minimumEngine === undefined
      ? engineDropsRetainedRecord(input.engineVersion)
      : engineDropsRetainedRecord(input.engineVersion, input.minimumEngine)
  if (!engineReady) return undefined
  const port = await input.deliveries()
  if (port === undefined) return undefined
  const consumer = createDeliveryConsumer({
    store: input.store,
    port,
    agentDir: input.agentDir,
    sessionsDirectory: input.sessionsDirectory,
    wake: input.wake,
  })
  input.onConsumer?.(consumer)
  let started: ConsumerStart
  try {
    started = await consumer.start()
  } catch (error) {
    consumer.stop()
    port.close?.()
    input.onDied?.()
    input.log(`thread wake: the delivery consumer did not start: ${error instanceof Error ? error.message : String(error)}`)
    return undefined
  }
  if (started !== "serving") {
    consumer.stop()
    port.close?.()
    input.onDied?.()
    input.log(`thread wake: the device service serves no deliveries to this engine (${started})`)
    return undefined
  }
  const admitIntake = async (device: string): Promise<IntakeAdmission> =>
    (await port.peerAdmitted(device)) ? "admitted" : "refused"
  let ended = false
  void port.closed?.then(() => {
    ended = true
    consumer.stop()
    input.onDied?.()
    input.onClosed?.()
  })
  await runPendingSweep({ store: input.store, admitIntake, wake: input.wake, sameDevice: input.sameDevice() })
  // The connection ended while the sweep ran: the service is gone, so this consumer is not returned as serving.
  if (ended) return undefined
  return {
    consumer,
    admitIntake,
    close: () => {
      consumer.stop()
      port.close?.()
    },
  }
}
