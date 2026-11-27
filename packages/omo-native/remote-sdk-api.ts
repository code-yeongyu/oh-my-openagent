// The public surface of `omo-ai/remote` (#13413). script/build-remote-sdk.ts emits the published declarations from
// this file, so they reach only the remote module's leaf types, never its implementation graph: every import here is
// type-only (guard G1 lets this file name components/remote's types directly, nothing else). remote-sdk.ts supplies the
// runtime values from the module's barrel.
import type { RemoteCode } from "../omo-senpi/src/components/remote/codes.ts"
import type * as Seams from "../omo-senpi/src/components/remote/seams.ts"
import type { RemoteClient } from "../omo-senpi/src/components/remote/types.ts"

export type * from "../omo-senpi/src/components/remote/types.ts"
export type { RemoteCode }
export type { CanonicalThread } from "../omo-senpi/src/components/remote/seams.ts"

export type Remote = RemoteClient
export type OpenRemoteOptions = {
  /** The device service state directory; defaults to this user's (`OMO_DEVICE_SERVICE_STATE_DIR` overrides it). */
  readonly stateDir?: string
}
/** One remote client acting as the person running the script (the `omo` command's identity); call `close()` when done. */
export type OpenRemote = (options?: OpenRemoteOptions) => Remote

/** @public */
export declare const openRemote: OpenRemote
/** @public Every code a failure may carry. */
export declare const REMOTE_CODES: readonly RemoteCode[]
/** @public The only thread-address parser. */
export declare const canonicalizeThreadHandle: typeof Seams.canonicalizeThreadHandle
/** @public A listed session's display name. */
export declare const describeThread: typeof Seams.describeThread
/** @public A thread handle from a device id and a session id. */
export declare const handleOf: typeof Seams.handleOf
