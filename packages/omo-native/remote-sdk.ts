// Entry of `omo-ai/remote` (#13413), bundled by script/build-remote-sdk.ts into bin/lib/remote-sdk.generated.js. Its
// declarations are remote-sdk-api.ts's; the values come from the remote module's barrel, its only import.
import { remoteClientForPerson } from "../omo-senpi/src/components/remote/index.ts"
import type { OpenRemote } from "./remote-sdk-api.ts"
import packageJson from "./package.json" with { type: "json" }

export type * from "./remote-sdk-api.ts"
/** @public */
export {
  /** @public */ canonicalizeThreadHandle,
  /** @public */ describeThread,
  /** @public */ handleOf,
  /** @public */ REMOTE_CODES,
} from "../omo-senpi/src/components/remote/index.ts"

/** @public */
export const openRemote: OpenRemote = (options = {}) =>
  remoteClientForPerson({ version: packageJson.version, ...options })
