import type { resolveAddress as ResolveAddress } from "./resolve"

// omo.js has a few hundred bytes of budget left: the resolver ships in the thread client sidecar, which every thread
// operation already loads, and this file is all of it the entry bundle carries (the lazy-ops.ts pattern).
export const resolveAddress = async (...args: Parameters<typeof ResolveAddress>) =>
  await (await import("#omo-thread-client-runtime")).resolveAddress(...args)
