// The local-versus-relay pair-test helper (#13478, #13961). A pair test DECLARES the engine RPC methods it covers in a
// `*.pair.ts` file; script/rpc-relay-parity.ts reads only those declarations for the parity table. The test then proves
// the declaration: every declared method must appear among the frames it actually sent on BOTH legs, so a declaration
// for a method the test never sends fails.
import type { RpcMethod } from "./rpc-methods.generated"

/** A pair test: its test file (repository-relative) and the engine RPC methods it proves on the local and relay legs. */
export interface PairTest {
  readonly test: string
  readonly covers: readonly RpcMethod[]
}

/** The record types each leg sent: `relay`, the RPC records sent to the other device; `local`, this device's frames. */
export interface LegFrames {
  readonly local: readonly string[]
  readonly relay: readonly string[]
}

/** Declares a pair test; `covers` is typed against the pinned engine's method list, so an unknown name fails typecheck. */
export const pairTest = (declaration: PairTest): PairTest => declaration

/**
 * The local leg's frame for an engine RPC record is the session-runtime call the engine makes for that record on this
 * device: the gateway drain admits a delivery with `runtime.admitExternalMessage`, the in-process form of the
 * `admit_external_message` record the relay leg sends.
 */
export const LOCAL_FRAME_OF = {
  admitExternalMessage: "admit_external_message",
} as const satisfies Readonly<Record<string, RpcMethod>>

/** Each declared method that a leg never sent. An empty list is the proof that the declaration is true. */
export function uncoveredMethods(declaration: PairTest, frames: LegFrames): string[] {
  return declaration.covers.flatMap((method) => [
    ...(frames.local.includes(method) ? [] : [`${method}: no frame on the local leg`]),
    ...(frames.relay.includes(method) ? [] : [`${method}: no frame on the relay leg`]),
  ])
}
