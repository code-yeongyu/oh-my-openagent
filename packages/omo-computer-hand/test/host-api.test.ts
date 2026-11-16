import { chmodSync, mkdirSync, symlinkSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

import { callHostApi, serveHostApi, type EnsureCaller, type HostAddress } from "../src/index.ts"
import { socketDirs } from "./support/tmp.ts"

const temp = socketDirs("omo-h-")

async function withServer<T>(
  address: HostAddress,
  run: (ensured: EnsureCaller[], statuses: () => number) => Promise<T>,
): Promise<T> {
  const ensured: EnsureCaller[] = []
  let statuses = 0
  const server = await serveHostApi(address, {
    status: () => {
      statuses += 1
      return { consentFingerprint: "fp-1", latch: { suspended: true, stopEpoch: 3 } }
    },
    ensure: async (caller) => {
      ensured.push(caller)
      return { kind: "ensured", endpoint: "/run/engine.sock", capability: "ab".repeat(32), generation: 2 }
    },
  })
  try {
    return await run(ensured, () => statuses)
  } finally {
    await server.close()
  }
}

describe("the host's local API", () => {
  it("answers hand.status with the consent fingerprint and the latch, the reply a host-less engine reads", async () => {
    const path = join(temp(), "host-api.sock")
    await withServer({ kind: "socket", path }, async () => {
      expect(await callHostApi({ kind: "socket", path }, "hand.status", {})).toMatchObject({
        result: { consentFingerprint: "fp-1", latch: { suspended: true, stopEpoch: 3 } },
      })
    })
  })

  it("hand.ensure takes the caller's pid and process start and answers the endpoint, capability and generation", async () => {
    const path = join(temp(), "host-api.sock")
    await withServer({ kind: "socket", path }, async (ensured) => {
      const reply = await callHostApi({ kind: "socket", path }, "hand.ensure", { pid: 4242, processStart: 77 })
      expect(reply).toMatchObject({ result: { kind: "ensured", endpoint: "/run/engine.sock", generation: 2 } })
      expect(ensured).toEqual([{ pid: 4242, processStart: 77 }])
    })
  })

  it("refuses unknown methods and malformed params without calling a handler", async () => {
    const path = join(temp(), "host-api.sock")
    await withServer({ kind: "socket", path }, async (ensured) => {
      expect(await callHostApi({ kind: "socket", path }, "hand.resume", {})).toMatchObject({
        error: { code: -32601, data: { reason: "unknown" } },
      })
      expect(await callHostApi({ kind: "socket", path }, "hand.ensure", { pid: "4242" })).toMatchObject({
        error: { code: -32602 },
      })
      expect(await callHostApi({ kind: "socket", path }, "hand.ensure", { pid: -1, processStart: 1 })).toMatchObject({
        error: { code: -32602 },
      })
      expect(ensured).toEqual([])
    })
  })

  it("binds only inside an owner-only directory: a directory other users can enter is refused before any bind", async () => {
    // Given a socket directory other users can traverse (0755).
    const dir = join(temp(), "open")
    mkdirSync(dir, { mode: 0o755 })
    chmodSync(dir, 0o755)

    // Then the host refuses to serve there, so no other uid can ever reach hand.status or hand.ensure.
    await expect(
      serveHostApi(
        { kind: "socket", path: join(dir, "host-api.sock") },
        {
          status: () => ({ consentFingerprint: "x", latch: { suspended: false, stopEpoch: 0 } }),
          ensure: async () => ({ kind: "refused", code: "RemoteCommandsDisabled" }),
        },
      ),
    ).rejects.toMatchObject({ reason: "host_api_dir_not_owner_only" })
  })

  it("a live host API at the address is another host's: a second host refuses instead of taking it over", async () => {
    const path = join(temp(), "host-api.sock")
    await withServer({ kind: "socket", path }, async () => {
      await expect(
        serveHostApi(
          { kind: "socket", path },
          {
            status: () => ({ consentFingerprint: "x", latch: { suspended: false, stopEpoch: 0 } }),
            ensure: async () => ({ kind: "refused", code: "RemoteCommandsDisabled" }),
          },
        ),
      ).rejects.toMatchObject({ reason: "host_api_in_use" })
    })
  })

  it("the client never dials an address it cannot verify as this uid's own socket in an owner-only directory", async () => {
    // Given a real host API in an owner-only directory.
    const home = temp()
    const path = join(home, "host-api.sock")
    await withServer({ kind: "socket", path }, async (ensured, statuses) => {
      // When the address is a symlink to it (a squatter pointing callers elsewhere): refused, never dialed.
      const linked = join(temp(), "host-api.sock")
      symlinkSync(path, linked)
      await expect(callHostApi({ kind: "socket", path: linked }, "hand.status", {})).rejects.toMatchObject({
        reason: "host_api_not_our_socket",
      })

      // When the address is a plain file, not a socket: refused.
      const plain = join(temp(), "host-api.sock")
      writeFileSync(plain, "")
      await expect(callHostApi({ kind: "socket", path: plain }, "hand.ensure", {})).rejects.toMatchObject({
        reason: "host_api_not_our_socket",
      })

      // When the socket's directory is opened to other users: refused, nothing dialed.
      chmodSync(home, 0o755)
      await expect(callHostApi({ kind: "socket", path }, "hand.status", {})).rejects.toMatchObject({
        reason: "host_api_dir_not_owner_only",
      })

      // Then no request reached the real host.
      expect(statuses()).toBe(0)
      expect(ensured).toEqual([])
    })
  })
})
