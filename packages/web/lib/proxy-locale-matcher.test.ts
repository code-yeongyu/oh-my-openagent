import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { NextRequest } from "next/server"

import { locales } from "../i18n/config"
import proxy, { config } from "../proxy"

const proxySource = readFileSync(resolve(import.meta.dir, "../proxy.ts"), "utf8")

const redirectOf = (path: string) => {
  const response = proxy(new NextRequest(new URL(path, "https://omo.dev")))
  return { status: response.status, location: response.headers.get("location") }
}

// Shipped desktop builds open https://omo.dev/download (reinstall screen, deb update pill). While the
// omo.dev page is off, that path must reach the public stable download page instead of a 404.
describe("desktop download path while the omo.dev download page is off", () => {
  const saved = process.env.OMO_WEB_DESKTOP_DOWNLOAD
  beforeEach(() => {
    delete process.env.OMO_WEB_DESKTOP_DOWNLOAD
  })
  afterEach(() => {
    if (saved === undefined) delete process.env.OMO_WEB_DESKTOP_DOWNLOAD
    else process.env.OMO_WEB_DESKTOP_DOWNLOAD = saved
  })

  test.each([
    "/download",
    "/download?channel=stable",
    "/download?channel=nightly",
    ...locales.map((locale) => `/${locale}/download`),
  ])(
    "#given %s #when requested #then it redirects temporarily to the public stable download page",
    (path) => {
      expect(redirectOf(path)).toEqual({
        status: 307,
        location: "https://get.omo.dev/desktop/stable/",
      })
    },
  )

  test.each([
    "/download?channel=beta",
    ...locales.map((locale) => `/${locale}/download?channel=beta`),
  ])(
    "#given %s #when requested #then it redirects temporarily to the public beta download page",
    (path) => {
      expect(redirectOf(path)).toEqual({
        status: 307,
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

// #12579: omo.dev/install and /install.sh returned 404; they hand the installer scripts over to get.omo.dev.
describe("installer script paths on omo.dev", () => {
  test.each([
    ["/install", "https://get.omo.dev/install.sh"],
    ["/install.sh", "https://get.omo.dev/install.sh"],
    ["/install.ps1", "https://get.omo.dev/install.ps1"],
  ])("#given %s #when requested #then it redirects permanently to %s", (path, location) => {
    expect(redirectOf(path)).toEqual({ status: 308, location })
  })

  // Next.js runs the proxy only for paths the exported matcher accepts: a literal entry, or the generic
  // pattern, which excludes every path with a dot. Checked on the exported value, not the source text.
  const matcherAccepts = (path: string) =>
    config.matcher.some((entry) => entry === path || (entry.startsWith("/(") && new RegExp(`^${entry}$`).test(path)))

  test.each(["/install", "/install.sh", "/install.ps1"])(
    "#given the active matcher #when %s is requested #then the proxy runs for it",
    (path) => {
      expect(matcherAccepts(path)).toBe(true)
    },
  )

  test("#given the active matcher #when another dotted path is requested #then the proxy stays out of it", () => {
    expect(matcherAccepts("/favicon.ico")).toBe(false)
    expect(matcherAccepts("/install.txt")).toBe(false)
  })
})
