import type * as CrossDevice from "./cross-device"
import type * as RemoteOps from "./remote-ops"
import type * as RemoteControls from "./remote-controls"
import type * as RelayTransport from "./relay-transport"
import type { DeliveryTransport } from "../gateway/transport"

type Runtime = Pick<typeof CrossDevice, "crossTarget" | "listAcross" | "planCreate" | "renameAlias" | "withAlias"> & Pick<typeof RemoteOps, "closeRemote" | "deviceOnline" | "interruptRemote" | "outcomeFailure" | "readRemote"> & Pick<typeof RemoteControls, "setModelRemote"> & Pick<typeof RelayTransport, "createRelayTransport">

// The cross-device half ships in the thread client sidecar (`#omo-thread-client-runtime`), which every thread
// operation already loads for the live host, so `omo.js` carries none of it.
const runtime = (): Promise<Runtime> => import("#omo-thread-client-runtime")

export const crossTarget = async (...args: Parameters<Runtime["crossTarget"]>) => await (await runtime()).crossTarget(...args)
export const listAcross = async (...args: Parameters<Runtime["listAcross"]>) => await (await runtime()).listAcross(...args)
export const planCreate = async (...args: Parameters<Runtime["planCreate"]>) => await (await runtime()).planCreate(...args)
export const renameAlias = async (...args: Parameters<Runtime["renameAlias"]>) => await (await runtime()).renameAlias(...args)
export const withAlias = async (...args: Parameters<Runtime["withAlias"]>) => await (await runtime()).withAlias(...args)
export const closeRemote = async (...args: Parameters<Runtime["closeRemote"]>) => await (await runtime()).closeRemote(...args)
export const deviceOnline = async (...args: Parameters<Runtime["deviceOnline"]>) => await (await runtime()).deviceOnline(...args)
export const interruptRemote = async (...args: Parameters<Runtime["interruptRemote"]>) => await (await runtime()).interruptRemote(...args)
export const outcomeFailure = async (...args: Parameters<Runtime["outcomeFailure"]>) => (await runtime()).outcomeFailure(...args)
export const setModelRemote = async (...args: Parameters<Runtime["setModelRemote"]>) => await (await runtime()).setModelRemote(...args)
export const readRemote = async (...args: Parameters<Runtime["readRemote"]>) => await (await runtime()).readRemote(...args)

/** The relay transport lives in the sidecar too; it is built once per composition, on the first delivery, and keeps its state. */
export const createRelayTransport = (options: Parameters<Runtime["createRelayTransport"]>[0]): DeliveryTransport & { readonly dispose: () => void } => {
  let built: Promise<DeliveryTransport & { readonly dispose: () => void }> | undefined
  return {
    deliver: async (delivery) => {
      // Only a failed sidecar load is retried; a delivery that throws keeps the instance and its receipt notes.
      built ??= runtime().then((loaded) => loaded.createRelayTransport(options)).catch((error: unknown) => { built = undefined; throw error })
      return await (await built).deliver(delivery)
    },
    // Stops the background re-sends of held deliveries; a transport never built has none.
    dispose: () => { built?.then((transport) => transport.dispose()).catch(() => undefined) },
  }
}
