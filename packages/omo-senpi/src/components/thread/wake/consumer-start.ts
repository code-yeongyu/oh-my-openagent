import { createDeliveryConsumer, type DeliveryConsumer } from "../consumer/consumer"
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
  readonly log: (line: string) => void
}

/**
 * The one delivery consumer of an engine process (#13037 design 5.4): it declares this agent directory to the device
 * service, then wakes every session whose intake rows wait on an admitted sender (the pending sweep, 5.4 step 6). On an
 * engine below the wake minimum (A8.1) it opens no connection and declares nothing.
 */
export type ServingConsumer = {
  readonly consumer: DeliveryConsumer
  /** The device service's answer to whether a device is admitted now (5.6), for a woken session's drain. */
  readonly admitIntake: (device: string) => Promise<IntakeAdmission>
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
  const started = await consumer.start()
  if (started !== "serving") {
    consumer.stop()
    input.log(`thread wake: the device service serves no deliveries to this engine (${started})`)
    return undefined
  }
  const admitIntake = async (device: string): Promise<IntakeAdmission> =>
    (await port.peerAdmitted(device)) ? "admitted" : "refused"
  await runPendingSweep({ store: input.store, admitIntake, wake: input.wake, sameDevice: input.sameDevice() })
  return { consumer, admitIntake }
}
