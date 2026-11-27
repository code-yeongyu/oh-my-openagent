// The remote module's second public entry (#13414 U5, guard S3): the lazy remote surface the eagerly loaded thread tools
// build in omo.js, with nothing from the client or its factories in its static graph (lazy.test.ts). The client loads
// only when the surface first needs it, through the runtime the caller hands it.
export { createLazyRemoteSurface } from "./port/lazy-remote"
export type { RemoteFailure, RemoteSender } from "./types"
