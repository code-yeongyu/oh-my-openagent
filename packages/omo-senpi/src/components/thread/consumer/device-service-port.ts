import { connectDeliveryConsumer, deviceServiceStateDir } from "@oh-my-opencode/device-service-core"

import type { DeliveryServicePort } from "./port"

/**
 * The production delivery port (#13037 design 5.4): this device's service through device-service-core's own client,
 * the one module that speaks to the relay daemon. No device service answering means no port, so no consumer.
 */
export async function connectDeliveryServicePort(options: {
  readonly version: string
  readonly stateDir?: string
}): Promise<DeliveryServicePort | undefined> {
  let client: Awaited<ReturnType<typeof connectDeliveryConsumer>>
  try {
    client = await connectDeliveryConsumer({
      version: options.version,
      stateDir: options.stateDir ?? deviceServiceStateDir(),
    })
  } catch {
    return undefined
  }
  return {
    serve: (request) => client.serve(request),
    answer: (delivery, reply) => client.answer(delivery, reply as Parameters<typeof client.answer>[1]),
    held: (askId, holds) => client.held(askId, holds),
    peerAdmitted: (device) => client.peerAdmitted(device),
    pending: (pairs) => client.pending(pairs),
    drained: (pair) => client.drained(pair),
    onInbound: (listener) => client.onInbound((event) => listener(event)),
    onHolds: (listener) => client.onHolds((event) => listener(event)),
    onWake: (listener) => client.onWake(listener),
    closed: client.closed,
    close: () => client.close(),
  }
}
