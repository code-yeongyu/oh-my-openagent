// The public surface of `omo-ai/remote` (#13413). script/build-remote-sdk.ts emits the published declarations from
// this file, so they reach only the remote module's public types, never its implementation graph; remote-sdk.ts
// re-exports it and implements `openRemote` against the type declared here. Each value is tagged @public: knip
// cannot trace the generated bundle back to this file.
import type { RemoteClient } from "../omo-senpi/src/components/remote/types.ts"

/** @public */
export { REMOTE_CODES } from "../omo-senpi/src/components/remote/codes.ts"
/** @public */
export { canonicalizeThreadHandle, describeThread, handleOf } from "../omo-senpi/src/components/remote/seams.ts"
export type * from "../omo-senpi/src/components/remote/types.ts"

export type Remote = RemoteClient
export type OpenRemoteOptions = {
  /** The device service state directory; defaults to this user's (`OMO_DEVICE_SERVICE_STATE_DIR` overrides it). */
  readonly stateDir?: string
}
/** One remote client acting as the person running the script (the `omo` command's identity); call `close()` when done. */
export type OpenRemote = (options?: OpenRemoteOptions) => Remote

/** @public */
export declare const openRemote: OpenRemote
