import type * as CrossDevice from "./cross-device"
import { rowThreadId } from "./ports"
import type * as RemoteOps from "./remote-ops"
import type * as RelayTransport from "./relay-transport"
import type * as RelayControl from "../control/relay-control"
import type { SessionControl } from "../control/port"
import type { DeliveryTransport } from "../gateway/transport"
import type { RemoteSessionRow, RemoteThreadSurface } from "./ports"

type Runtime = Pick<
  typeof CrossDevice,
  "claimCreatedAlias" | "listAcross" | "planCreate" | "renameAlias" | "withAlias"
> &
  Pick<typeof RemoteOps, "deviceOnline"> &
  Pick<typeof RelayTransport, "createRelayTransport"> &
  Pick<typeof RelayControl, "createRelayControl">

// The cross-device half ships in the thread client sidecar (`#omo-thread-client-runtime`), which every thread
// operation already loads for the live host, so `omo.js` carries none of it.
const runtime = (): Promise<Runtime> => import("#omo-thread-client-runtime")

export const listAcross = async (...args: Parameters<Runtime["listAcross"]>) =>
  await (await runtime()).listAcross(...args)
export const planCreate = async (...args: Parameters<Runtime["planCreate"]>) =>
  await (await runtime()).planCreate(...args)
export const renameAlias = async (...args: Parameters<Runtime["renameAlias"]>) =>
  await (await runtime()).renameAlias(...args)
export const withAlias = async (...args: Parameters<Runtime["withAlias"]>) => await (await runtime()).withAlias(...args)
export const claimCreatedAlias = async (...args: Parameters<Runtime["claimCreatedAlias"]>) =>
  await (await runtime()).claimCreatedAlias(...args)
export const deviceOnline = async (...args: Parameters<Runtime["deviceOnline"]>) =>
  await (await runtime()).deviceOnline(...args)

/** The relay transport lives in the sidecar too; it is built once per composition, on the first delivery, and keeps its state. */
export const createRelayTransport = (
  options: Parameters<Runtime["createRelayTransport"]>[0],
): DeliveryTransport & { readonly dispose: () => void } => {
  let built: Promise<DeliveryTransport & { readonly dispose: () => void }> | undefined
  return {
    deliver: async (delivery) => {
      // Only a failed sidecar load is retried; a delivery that throws keeps the instance and its receipt notes.
      built ??= runtime()
        .then((loaded) => loaded.createRelayTransport(options))
        .catch((error: unknown) => {
          built = undefined
          throw error
        })
      return await (await built).deliver(delivery)
    },
    // Stops the background re-sends of held deliveries; a transport never built has none.
    dispose: () => {
      built?.then((transport) => transport.dispose()).catch(() => undefined)
    },
  }
}

/** The control of a thread on another device, from the sidecar; its identity is the listing row's, read with no load. */
export const createRelayControl = (remote: RemoteThreadSurface, row: RemoteSessionRow): SessionControl => {
  const built = runtime().then((loaded) => loaded.createRelayControl(remote, row))
  return {
    thread_id: rowThreadId(row),
    device: row.device,
    title: row.title,
    visible: async () => await (await built).visible(),
    interrupt: async (turnId) => await (await built).interrupt(turnId),
    close: async () => await (await built).close(),
    setName: async (name) => await (await built).setName(name),
    getAvailableModels: async (options) => await (await built).getAvailableModels(options),
    setModel: async (provider, id) => await (await built).setModel(provider, id),
    getAvailableThinkingLevels: async () => await (await built).getAvailableThinkingLevels(),
    setThinkingLevel: async (level, scope) => await (await built).setThinkingLevel(level, scope),
    getMessages: async () => await (await built).getMessages(),
  }
}
