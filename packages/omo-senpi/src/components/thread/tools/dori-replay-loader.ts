declare const OMO_SENPI_BUNDLED: boolean | undefined

/**
 * The replay journal module, loaded only when a layer-2 call needs it. The built plugin ships it as
 * `runtime/dori/replay.js` beside the extensions directory, so the entry bundle carries none of it.
 */
export function loadDoriReplayModule(): Promise<typeof import("./dori-replay")> {
  const bundled = typeof OMO_SENPI_BUNDLED !== "undefined" && OMO_SENPI_BUNDLED
  const url = bundled ? new URL("../runtime/dori/replay.js", import.meta.url) : new URL("./dori-replay.ts", import.meta.url)
  return import(url.href) as Promise<typeof import("./dori-replay")>
}
