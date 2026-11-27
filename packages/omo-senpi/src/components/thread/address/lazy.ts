import type { resolve as Resolve } from "./contract"

// omo.js has a few hundred bytes of budget left: the resolver ships in the thread client sidecar, which every thread
// operation already loads, and this file is all of it the entry bundle carries (the lazy-ops.ts pattern).
export const resolve = async (...args: Parameters<typeof Resolve>): ReturnType<typeof Resolve> =>
  (await import("#omo-thread-client-runtime")).resolve(...args)
