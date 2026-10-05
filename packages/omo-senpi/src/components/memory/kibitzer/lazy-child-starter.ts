import type { createKibitzerSidecarChildStarter, KibitzerSidecarChildStarterOptions } from "./sidecar-model"

import { KibitzerSidecarStartError } from "./sidecar-start-error"

type Starter = ReturnType<typeof createKibitzerSidecarChildStarter>
type Runtime = Pick<typeof import("./sidecar-model"), "createKibitzerSidecarChildStarter">

/** Keep hook registration and snapshots eager; load the child factory only at the first wake. */
export function createLazyKibitzerChildStarter(
  options: KibitzerSidecarChildStarterOptions,
  loadRuntime: () => Promise<Runtime> = () => import("#omo-kibitzer-child-runtime"),
): Starter {
  let starter: Promise<Starter> | undefined
  return async (input) => {
    if (starter === undefined) {
      const loading = loadRuntime().then((runtime) => runtime.createKibitzerSidecarChildStarter(options, KibitzerSidecarStartError))
      starter = loading
      void loading.catch(() => {
        if (starter === loading) starter = undefined
      })
    }
    return (await starter)(input)
  }
}
