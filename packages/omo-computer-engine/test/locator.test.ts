import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"

import { ENGINE_RELEASE_HOSTS, engineHost, libcFromSignals, locateEngine, releaseAssetName } from "../src/index.ts"

let root: string

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "omo-computer-engine-locator-"))
})
afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

const dirs = () => ({
  runtimeDir: "",
  execDir: join(root, "bin"),
  packageDir: join(root, "package"),
  repoRoot: join(root, "repo"),
})

describe("host naming and release assets", () => {
  it("names the host <platform>-<arch> with -musl only on musl Linux", () => {
    expect(engineHost("linux", "x64", "glibc")).toBe("linux-x64")
    expect(engineHost("linux", "arm64", "musl")).toBe("linux-arm64-musl")
    expect(engineHost("darwin", "arm64", "musl")).toBe("darwin-arm64")
    expect(engineHost("win32", "x64")).toBe("win32-x64")
  })

  it("names every release asset after the engine and the host, .exe on Windows", () => {
    expect(ENGINE_RELEASE_HOSTS.map(releaseAssetName)).toEqual([
      "omo-computer-engine-darwin-arm64",
      "omo-computer-engine-darwin-x64",
      "omo-computer-engine-linux-x64",
      "omo-computer-engine-linux-arm64",
      "omo-computer-engine-win32-x64.exe",
      "omo-computer-engine-win32-arm64.exe",
    ])
  })

  it("reads libc from the running process: a glibc runtime version wins, musl needs its loader mapped", () => {
    expect(libcFromSignals({ header: { glibcVersionRuntime: "2.39" } }, () => "/lib/ld-musl-x86_64.so.1")).toBe("glibc")
    expect(libcFromSignals({ header: {} }, () => "7f00-7f01 r-xp 0 0:0 1 /lib/ld-musl-x86_64.so.1")).toBe("musl")
    expect(libcFromSignals({ header: {} }, () => undefined)).toBe("glibc")
  })
})

describe("locator", () => {
  it("musl_host_gets_no_release_asset_reason", () => {
    // Given a musl Linux host with no engine anywhere (no musl build is published).
    // When the locator runs.
    const located = locateEngine({ platform: "linux", arch: "x64", libc: "musl", ...dirs() })

    // Then it names the missing release asset as the reason, not a broken install.
    expect(located.kind).toBe("unavailable")
    expect(located).toMatchObject({ host: "linux-x64-musl", code: "native-unavailable", reason: "no-release-asset" })
  })

  it("a glibc host with nothing installed is unavailable without the no-release-asset reason", () => {
    const located = locateEngine({ platform: "linux", arch: "x64", libc: "glibc", ...dirs() })
    expect(located).toMatchObject({ kind: "unavailable", code: "native-unavailable" })
    expect(located).not.toHaveProperty("reason")
  })

  it("a quarantined candidate is reported, never launched, and the attribute is left alone", () => {
    // Given a macOS prebuild that carries the quarantine attribute.
    const engine = join(root, "package", "native", "prebuilds", "darwin-arm64", "omo-computer-engine")
    mkdirSync(join(engine, ".."), { recursive: true })
    writeFileSync(engine, "macho")
    chmodSync(engine, 0o755)

    // When the locator runs with a quarantine probe that answers yes.
    const located = locateEngine({ platform: "darwin", arch: "arm64", ...dirs(), isQuarantined: () => true })

    // Then the diagnostic names the quarantine and the path.
    expect(located).toMatchObject({ kind: "unavailable", code: "quarantined", host: "darwin-arm64" })
    expect(located.kind === "unavailable" && located.attemptedPaths).toContain(engine)
  })

  it("the first executable candidate wins, in the documented order", () => {
    // Given a sidecar beside the executable and a package prebuild.
    const sidecar = join(root, "bin", "native", "prebuilds", "linux-x64", "omo-computer-engine")
    const prebuild = join(root, "package", "native", "prebuilds", "linux-x64", "omo-computer-engine")
    for (const path of [sidecar, prebuild]) {
      mkdirSync(join(path, ".."), { recursive: true })
      writeFileSync(path, "elf")
      chmodSync(path, 0o755)
    }

    // When the locator runs.
    const located = locateEngine({ platform: "linux", arch: "x64", libc: "glibc", ...dirs() })

    // Then the sidecar wins.
    expect(located).toMatchObject({ kind: "located", path: sidecar, origin: "sidecar" })
  })
})
