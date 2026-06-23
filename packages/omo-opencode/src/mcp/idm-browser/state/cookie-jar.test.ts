import { describe, test, expect, afterEach } from "bun:test"
import { join } from "node:path"
import { unlinkSync } from "node:fs"
import { createCookieJar, type StoredCookie } from "./cookie-jar"

const TEST_DB = join(import.meta.dir, ".test-cookies.sqlite")

describe("CookieJar", () => {
  let jar: ReturnType<typeof createCookieJar>

  afterEach(() => {
    jar?.close()
    try { unlinkSync(TEST_DB) } catch { /* cleanup */ }
    try { unlinkSync(TEST_DB + "-wal") } catch { /* cleanup */ }
    try { unlinkSync(TEST_DB + "-shm") } catch { /* cleanup */ }
  })

  describe("#given empty jar", () => {
    test("#when exportCookies #then returns empty array", () => {
      jar = createCookieJar(TEST_DB)
      expect(jar.exportCookies("profile1")).toEqual([])
    })
  })

  describe("#given imported cookies", () => {
    test("#when exportCookies #then returns stored cookies", () => {
      jar = createCookieJar(TEST_DB)
      const cookie: StoredCookie = {
        name: "session",
        value: "abc123",
        domain: ".example.com",
        path: "/",
        expires: Date.now() + 86400000,
        httpOnly: true,
        secure: true,
        sameSite: "Lax",
      }
      jar.importCookies("profile1", [cookie])
      const exported = jar.exportCookies("profile1")
      expect(exported).toHaveLength(1)
      expect(exported[0]!.name).toBe("session")
      expect(exported[0]!.value).toBe("abc123")
    })

    test("#when clearProfile #then cookies removed", () => {
      jar = createCookieJar(TEST_DB)
      jar.importCookies("profile1", [{
        name: "test", value: "val", domain: ".test.com",
        path: "/", expires: 0, httpOnly: false, secure: false, sameSite: "None",
      }])
      jar.clearProfile("profile1")
      expect(jar.exportCookies("profile1")).toEqual([])
    })
  })
})
