import { spyOn } from "bun:test"
import { join } from "node:path"
import * as resilient from "../../../fs/resilient"
import * as trustPin from "../trust-pin.ts"

/**
 * Makes listing `stateDir`'s anchor root fail with `code` once a real `pinTrustAnchor` has returned (#12382): the pin is
 * written and verified on the real disk, and only the root-change notice that follows it meets the failure. The caller
 * restores both spies with `mock.restore()`.
 */
export function failAnchorListingAfterPin(stateDir: string, code = "EACCES"): { readonly pinned: () => boolean } {
  const pin = trustPin.pinTrustAnchor
  let pinned = false
  spyOn(trustPin, "pinTrustAnchor").mockImplementation(async (...args) => {
    const anchor = await pin(...args)
    pinned = true
    return anchor
  })
  const listDir = resilient.readdir
  const anchorRoot = join(stateDir, "trust-anchor")
  spyOn(resilient, "readdir").mockImplementation(((path: Parameters<typeof listDir>[0]) =>
    pinned && String(path) === anchorRoot
      ? Promise.reject(Object.assign(new Error(`${code}: scandir '${String(path)}'`), { code }))
      : listDir(path)) as typeof listDir)
  return { pinned: () => pinned }
}
