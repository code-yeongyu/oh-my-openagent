// Entry of `omo-ai/sdk` (first-party design 4.1): the omo SDK root with the launcher library's cores this package
// ships, each built on its namespace's first call; importing the entry opens, reads and starts nothing.
import { assembleOmoSdk, refuseCallerCores } from "../omo-senpi/src/components/omo-sdk/assembly.ts"
import type { OmoSdk, OmoSdkOptions } from "../omo-senpi/src/components/omo-sdk/options.ts"
import { installCore } from "./bin/lib/sdk-install.js"

export type * from "../omo-senpi/src/components/omo-sdk/index.ts"

export function createOmoSdk(options: OmoSdkOptions = {}): OmoSdk {
  refuseCallerCores(options)
  return assembleOmoSdk(options, {
    cores: {
      install: async () => installCore(),
    },
  })
}
