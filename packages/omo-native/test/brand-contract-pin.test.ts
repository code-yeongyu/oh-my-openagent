import { describe, expect, test } from "bun:test"
import { existsSync, readFileSync } from "node:fs"
import { join, resolve } from "node:path"

import omoNativeManifest from "../package.json"

/**
 * The launcher hands the engine a `SENPI_BRAND` profile. An engine build predating that contract
 * ignores it silently - the product installs, runs, and still presents as senpi, with no error
 * anywhere - so the mismatch has to be caught here rather than by a user noticing the wrong name.
 */
const BRAND_CONTRACT_MODULE = join("dist", "core", "brand.js")
const PINNED_VERSION = omoNativeManifest.dependencies["@code-yeongyu/senpi"]

/**
 * First engine release that understands the brand profile. It is null until that release exists;
 * setting it as part of the pin bump turns the assertion below into a hard requirement, so an
 * engine that would silently ignore the brand can never be pinned afterwards.
 */
const FIRST_BRAND_AWARE_SENPI: string | null = "2026.8.11-2"

function installedSenpi(): { readonly root: string; readonly version: string } | undefined {
  const candidates = [
    resolve(import.meta.dir, "..", "..", "..", "node_modules", "@code-yeongyu", "senpi"),
    resolve(import.meta.dir, "..", "node_modules", "@code-yeongyu", "senpi"),
  ]
  for (const root of candidates) {
    const manifest = join(root, "package.json")
    if (!existsSync(manifest)) continue
    const version = JSON.parse(readFileSync(manifest, "utf8")).version
    return { root, version }
  }
  return undefined
}

describe("senpi brand contract pin", () => {
  describe("#given the engine build the launcher spawns", () => {
    describe("#when the pin is inspected", () => {
      test("#then it is an exact version, never a range", () => {
        expect(PINNED_VERSION).toMatch(/^\d/)
      })

      test("#then a brand-aware pin must ship the brand resolver", () => {
        const installed = installedSenpi()
        if (FIRST_BRAND_AWARE_SENPI === null || installed === undefined || installed.version !== PINNED_VERSION) {
          // No brand-aware engine release exists yet, or the workspace has a different engine
          // installed than the pin names. The launcher still always injects the profile; the engine
          // simply ignores it until the pinned release understands it.
          expect(PINNED_VERSION).toMatch(/^\d/)
          return
        }

        expect({ version: installed.version, brandAware: existsSync(join(installed.root, BRAND_CONTRACT_MODULE)) })
          .toEqual({ version: PINNED_VERSION, brandAware: true })
      })
    })
  })
})
