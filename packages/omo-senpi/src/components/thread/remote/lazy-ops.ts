import type * as CrossDevice from "./cross-device"
import type * as RemoteOps from "./remote-ops"
import type * as RemoteControls from "./remote-controls"

type Runtime = Pick<typeof CrossDevice, "crossTarget" | "listAcross" | "planCreate" | "renameAlias" | "withAlias"> & Pick<typeof RemoteOps, "closeRemote" | "deviceOnline" | "interruptRemote" | "outcomeFailure" | "promptRemote" | "readRemote"> & Pick<typeof RemoteControls, "setModelRemote">

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
export const promptRemote = async (...args: Parameters<Runtime["promptRemote"]>) => await (await runtime()).promptRemote(...args)
export const setModelRemote = async (...args: Parameters<Runtime["setModelRemote"]>) => await (await runtime()).setModelRemote(...args)
export const readRemote = async (...args: Parameters<Runtime["readRemote"]>) => await (await runtime()).readRemote(...args)
