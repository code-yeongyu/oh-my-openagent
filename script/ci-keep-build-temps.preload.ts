// Throwaway diagnostic preload: keep .build-check-* and .build-extension-test-* trees so a
// fixture-vs-rebuild mismatch on the runner can be diffed. Lives only on the probe branch.
import * as fsp from "node:fs/promises"
const realRm = fsp.rm
;(fsp as { rm: typeof fsp.rm }).rm = (async (path: Parameters<typeof fsp.rm>[0], options?: Parameters<typeof fsp.rm>[1]) => {
  if (/\.build-(check|extension-test)-/.test(String(path))) return
  return realRm(path, options)
}) as typeof fsp.rm
