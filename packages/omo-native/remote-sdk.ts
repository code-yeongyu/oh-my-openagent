// Entry of `omo-ai/remote` (#13413), bundled by script/build-remote-sdk.ts into bin/lib/remote-sdk.generated.js.
// Scripts import it by package name, which resolves to that generated bundle; knip cannot trace the bundle back to this
// file, so each public export is tagged @public.
import { remoteClientForPerson, type RemoteClient } from "../omo-senpi/src/components/remote/index.ts"
import packageJson from "./package.json" with { type: "json" }

/** @public */
export {
  canonicalizeThreadHandle,
  describeThread,
  handleOf,
  REMOTE_CODES,
} from "../omo-senpi/src/components/remote/index.ts"
export type * from "../omo-senpi/src/components/remote/types.ts"

export type Remote = RemoteClient
export type OpenRemoteOptions = {
  /** The device service state directory; defaults to this user's (`OMO_DEVICE_SERVICE_STATE_DIR` overrides it). */
  readonly stateDir?: string
}

/**
 * @public
 * One remote client acting as the person running the script (the `omo` command's identity); call `close()` when done.
 */
export const openRemote = (options: OpenRemoteOptions = {}): Remote =>
  remoteClientForPerson({ version: packageJson.version, ...options })
