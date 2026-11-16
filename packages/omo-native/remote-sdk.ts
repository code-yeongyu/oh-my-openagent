// Entry of `omo-ai/remote` (#13413), bundled by script/build-remote-sdk.ts into bin/lib/remote-sdk.generated.js.
// The public surface and its types live in remote-sdk-api.ts; this file adds the one runtime value it declares.
import { remoteClientForPerson } from "../omo-senpi/src/components/remote/index.ts"
import { createLocalAttach } from "../omo-senpi/src/components/remote/local-attach.ts"
import type { OpenRemote } from "./remote-sdk-api.ts"
import packageJson from "./package.json" with { type: "json" }

export * from "./remote-sdk-api.ts"

/** @public */
export const openRemote: OpenRemote = (options = {}) =>
  // A session on this device is reached through this device's engine, not the device service (#13868).
  remoteClientForPerson({ version: packageJson.version, localAttach: createLocalAttach(), ...options })
