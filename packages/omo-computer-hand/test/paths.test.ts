import { join } from "node:path"
import { describe, expect, it } from "vitest"

import { resolveHandPaths } from "../src/index.ts"

const base = { uid: 501, home: "/home/u", tmp: "/var/folders/xy/T" }

describe("hand paths: the same files and address the engine resolves", () => {
  it("under the fake-backend seam every file, the host API socket included, sits in the runtime dir", () => {
    // Given the seam set on a fake backend.
    const resolved = resolveHandPaths({
      ...base,
      platform: "linux",
      fake: true,
      env: { OMO_COMPUTER_RUNTIME_DIR: "/tmp/omo-test" },
    })

    // Then the host address, latch, consent, stop marker and session locks all sit under it.
    expect(resolved).toMatchObject({
      kind: "resolved",
      paths: {
        hostAddress: { kind: "socket", path: "/tmp/omo-test/host-api.sock" },
        hostLatch: "/tmp/omo-test/computer/host-latch",
        consent: "/tmp/omo-test/computer/consent.json",
        stopMarker: "/tmp/omo-test/global-stop",
        sessionLockDir: "/tmp/omo-test/sessions",
      },
    })
  })

  it("a real backend with the seam set names no path at all", () => {
    expect(
      resolveHandPaths({ ...base, platform: "linux", fake: false, env: { OMO_COMPUTER_RUNTIME_DIR: "/tmp/omo-test" } }),
    ).toEqual({
      kind: "unavailable",
      reason: "seam_with_real_backend",
    })
  })

  it("real Linux paths: XDG config and state, the per-uid runtime root holding the host API socket", () => {
    const resolved = resolveHandPaths({
      ...base,
      platform: "linux",
      fake: false,
      env: { XDG_RUNTIME_DIR: "/run/user/501" },
    })
    expect(resolved).toMatchObject({
      kind: "resolved",
      paths: {
        hostAddress: { kind: "socket", path: join("/run/user/501", "omo-computer", "501", "host-api.sock") },
        consent: "/home/u/.config/omo/computer/consent.json",
        stopMarker: "/home/u/.local/state/omo/computer-control/global-stop",
        sessionLockDir: join("/run/user/501", "omo-computer", "501", "sessions"),
      },
    })
  })

  it("the config root (host latch, consent) follows the user-database home, never $HOME, exactly like the engine", () => {
    // Given $HOME pointing somewhere else than the user database's home and no XDG_CONFIG_HOME.
    for (const platform of ["linux", "darwin"]) {
      const resolved = resolveHandPaths({
        ...base,
        platform,
        fake: false,
        env: { HOME: "/elsewhere", XDG_RUNTIME_DIR: "/run/user/501" },
      })

      // Then the latch the host writes is the one the engine reads: under the user-database home.
      expect(resolved.kind === "resolved" && resolved.paths.hostLatch.startsWith("/home/u/")).toBe(true)
    }
  })

  it("real macOS paths: Application Support for config and state, a socket file in the per-uid temp root", () => {
    const resolved = resolveHandPaths({ ...base, platform: "darwin", fake: false, env: {} })
    expect(resolved).toMatchObject({
      kind: "resolved",
      paths: {
        hostAddress: { kind: "socket", path: "/var/folders/xy/T/omo-computer/501/host-api.sock" },
        consent: "/home/u/Library/Application Support/OmO/computer/consent.json",
        stopMarker: "/home/u/Library/Application Support/OmO/ComputerControl/1/global-stop",
      },
    })
  })
})
