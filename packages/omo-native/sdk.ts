// Entry of `omo-ai/sdk` (first-party design 4.1): the omo SDK root with the launcher library's cores this package
// ships, each imported on its namespace's first call, so importing the entry opens, reads and starts nothing.
import { assembleOmoSdk, refuseCallerCores } from "../omo-senpi/src/components/omo-sdk/assembly.ts"
import type { OmoSdk, OmoSdkOptions } from "../omo-senpi/src/components/omo-sdk/options.ts"

export type * from "../omo-senpi/src/components/omo-sdk/index.ts"

export function createOmoSdk(options: OmoSdkOptions = {}): OmoSdk {
  refuseCallerCores(options)
  return assembleOmoSdk(options, {
    cores: { install: async () => (await import("./bin/lib/sdk-install.js")).installCore() },
  })
}
