import { join } from "node:path"

/** Where a device keeps its per-account sync trust pins: under the memory root, beside (never inside) every identity repository. */
export const syncPinDir = (memoryRoot: string): string => join(memoryRoot, "sync-device")
