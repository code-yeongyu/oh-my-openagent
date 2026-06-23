import { describe, test, expect, afterAll } from "bun:test"
import { ensureLocalBrowserServer, shutdownLocalBrowserServer } from "./lifecycle"

describe("lifecycle", () => {
  afterAll(async () => {
    await shutdownLocalBrowserServer()
  })

  describe("ensureLocalBrowserServer", () => {
    // TODO(camoufox-on-ci): /health response is non-JSON when camoufox isn't installed on the runner. Install camoufox via `bun x camoufox fetch` step in CI, or guard this test with skipIf(!isCamoufoxInstalled()).
    test.skip("#given fresh state #when called #then returns a port and starts server", async () => {
      const port = await ensureLocalBrowserServer()
      expect(port).toBeGreaterThanOrEqual(9876)

      const resp = await fetch(`http://127.0.0.1:${port}/health`)
      const body = await resp.json() as { ok: boolean }
      expect(body.ok).toBe(true)
    })

    test("#given called twice #when subsequent call #then returns same port", async () => {
      const a = await ensureLocalBrowserServer()
      const b = await ensureLocalBrowserServer()
      expect(b).toBe(a)
    })
  })
})
