import { describe, expect, test } from "bun:test"
import { loadVendoredPool, getVendoredEntries } from "./vendored-pool-loader"

describe("loadVendoredPool", () => {
  test("#given vendored-pool.json #when loaded #then validates against schema and has >=40 entries", () => {
    const pool = loadVendoredPool()
    expect(pool.pool.length).toBeGreaterThanOrEqual(40)
    expect(pool.meta.source).toContain("microlinkhq")
  })

  test("#given pool entries #when filtered by browser=chrome #then returns Chrome UAs only", () => {
    const chromes = getVendoredEntries({ browser: "chrome" })
    expect(chromes.length).toBeGreaterThan(0)
    for (const entry of chromes) {
      expect(entry.browser).toBe("chrome")
      expect(entry.ua).toMatch(/Chrome\/|CriOS\//)
    }
  })

  test("#given pool entries #when filtered by browser=firefox #then returns Firefox UAs only", () => {
    const firefoxes = getVendoredEntries({ browser: "firefox" })
    expect(firefoxes.length).toBeGreaterThan(0)
    for (const entry of firefoxes) {
      expect(entry.browser).toBe("firefox")
      expect(entry.ua).toContain("Firefox/")
    }
  })

  test("#given pool entries #when filtered by os=android type=mobile #then returns Android mobile UAs", () => {
    const androids = getVendoredEntries({ os: "android", type: "mobile" })
    expect(androids.length).toBeGreaterThan(0)
    for (const entry of androids) {
      expect(entry.os).toBe("android")
      expect(entry.type).toBe("mobile")
    }
  })

  test("#given pool entries #when checked for HeadlessChrome #then none present", () => {
    const pool = loadVendoredPool()
    for (const entry of pool.pool) {
      expect(entry.ua).not.toContain("HeadlessChrome")
    }
  })

  test("#given desktop chromes #when checked #then includes Chrome 148 stable", () => {
    const desktops = getVendoredEntries({ browser: "chrome", type: "desktop" })
    const has148 = desktops.some((e) => e.version.startsWith("148."))
    expect(has148).toBe(true)
  })
})
