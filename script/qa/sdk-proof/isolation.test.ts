import { afterAll, describe, expect, test } from "bun:test"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { assertWriteRoots, outsideWriteRoots } from "./world/write-roots.ts"

// The X1a world fails closed: the run refuses to start with a write root outside the scratch directory, and the guard
// every world process loads refuses and records a request to any address but loopback. Security-relevant isolation
// contract of the proof harness; each case pairs with the input that must not pass.

const dir = mkdtempSync(join(tmpdir(), "x1a-isolation-"))
afterAll(() => rmSync(dir, { recursive: true, force: true }))

describe("write roots", () => {
  test("#given every write root under the scratch directory #when checked #then none escapes", () => {
    expect(outsideWriteRoots({ HOME: join(dir, "home"), TMPDIR: join(dir, "tmp"), PATH: "/usr/bin" }, [dir])).toEqual(
      [],
    )
  })

  test("#given a write root outside the scratch directory #when checked #then it is named", () => {
    expect(outsideWriteRoots({ HOME: join(dir, "home"), TMPDIR: "/tmp" }, [dir])).toEqual(["TMPDIR=/tmp"])
  })

  test("#given a sibling whose name starts like the root #when checked #then it escapes", () => {
    expect(outsideWriteRoots({ HOME: `${dir}-other/home` }, [dir])).toEqual([`HOME=${dir}-other/home`])
  })
})

describe("the world's start", () => {
  test("#given a device environment whose write root escapes #when the world checks before launching #then it refuses naming it", () => {
    const escaping = [{ name: "device A", env: { HOME: join(dir, "a"), TMPDIR: "/tmp" }, root: dir }]
    expect(() => assertWriteRoots(escaping)).toThrow("device A: TMPDIR=/tmp")
  })

  test("#given every write root inside its scratch #when the world checks #then it starts", () => {
    expect(() => assertWriteRoots([{ name: "device A", env: { HOME: join(dir, "a") }, root: dir }])).not.toThrow()
  })
})

describe("the loopback guard", () => {
  const guard = join(import.meta.dir, "world", "loopback-guard.mjs")
  const probe = async (url: string) => {
    const refused = join(dir, `refused-${Math.random().toString(36).slice(2)}`)
    writeFileSync(refused, "")
    const script = `try { await fetch(${JSON.stringify(url)}, { signal: AbortSignal.timeout(2000) }); console.log("sent") } catch (error) { console.log(String(error).includes("only the loopback") ? "refused" : "failed") }`
    const child = Bun.spawn([process.execPath, "--preload", guard, "-e", script], {
      env: { PATH: process.env["PATH"] ?? "", X1A_REFUSED_FILE: refused },
      stdout: "pipe",
    })
    const [out] = await Promise.all([new Response(child.stdout).text(), child.exited])
    return { outcome: out.trim(), recorded: readFileSync(refused, "utf8") }
  }

  test("#given a request to a non-loopback address #when a guarded process sends it #then it is refused and recorded", async () => {
    const { outcome, recorded } = await probe("http://203.0.113.7:9/")
    expect([outcome, recorded.includes("203.0.113.7")]).toEqual(["refused", true])
  })

  test("#given a request to loopback #when a guarded process sends it #then it is not refused", async () => {
    const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response("ok") })
    try {
      const { outcome, recorded } = await probe(`http://127.0.0.1:${server.port}/`)
      expect([outcome, recorded]).toEqual(["sent", ""])
    } finally {
      server.stop(true)
    }
  })
})
