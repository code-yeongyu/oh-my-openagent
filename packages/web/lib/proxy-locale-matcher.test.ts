import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { NextRequest } from "next/server"

import { locales } from "../i18n/config"
import proxy from "../proxy"

const proxySource = readFileSync(resolve(import.meta.dir, "../proxy.ts"), "utf8")

const redirectOf = (path: string) => {
  const response = proxy(new NextRequest(new URL(path, "https://omo.dev")))
  return { status: response.status, location: response.headers.get("location") }
}

// Shipped desktop builds open https://omo.dev/download (reinstall screen, deb update pill). While the
// omo.dev page is off, that path must reach the public beta download page instead of a 404.
describe("desktop download path while the omo.dev download page is off", () => {
  test.each([
    "/download",
    "/download?channel=beta",
    ...locales.map((locale) => `/${locale}/download`),
  ])(
    "#given %s #when requested #then it redirects permanently to the public beta download page",
    (path) => {
      expect(redirectOf(path)).toEqual({
        status: 301,
        location: "https://get.omo.dev/desktop/beta/",
      })
    },
  )
})

describe("installation redirects in every locale", () => {
  test("#given the static matcher #when it names localized install paths #then it never lists locales by hand", () => {
    expect(proxySource).not.toMatch(/:locale\(/)
    for (const path of [
      "/:locale/installation.md",
      "/:locale/docs/installation.md",
      "/:locale/docs/guide/install.md",
    ]) {
      expect(proxySource).toContain(`"${path}"`)
    }
  })

  test.each([...locales])(
    "#given locale %s #when an old install path is requested #then it redirects to that locale's docs",
    (locale) => {
      expect(redirectOf(`/${locale}/installation.md`)).toEqual({
        status: 308,
        location: `https://omo.dev/${locale}/docs#installation`,
      })
      expect(redirectOf(`/${locale}/docs/installation.md`)).toEqual({
        status: 308,
        location: `https://omo.dev/${locale}/docs#installation`,
      })
      expect(redirectOf(`/${locale}/docs/guide/install.md`)).toEqual({
        status: 308,
        location: `https://omo.dev/${locale}/docs/install`,
      })
    },
  )
})
