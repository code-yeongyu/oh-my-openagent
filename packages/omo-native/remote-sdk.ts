import { createRemoteClient, type RemoteClient } from "../omo-senpi/src/components/remote/client.ts"
import packageJson from "./package.json" with { type: "json" }

export { REMOTE_CODES } from "../omo-senpi/src/components/remote/codes.ts"
export type * from "../omo-senpi/src/components/remote/types.ts"

export type Remote = RemoteClient
export type OpenRemoteOptions = {
  /** The device service state directory; defaults to this user's (`OMO_DEVICE_SERVICE_STATE_DIR` overrides it). */
  readonly stateDir?: string
}

/** One remote client acting as the person running the script; call `close()` when done. */
export const openRemote = (options: OpenRemoteOptions = {}): Remote =>
  createRemoteClient(
    { kind: "person", uid: String(process.getuid?.() ?? "person") },
    { version: packageJson.version, ...options },
  )
