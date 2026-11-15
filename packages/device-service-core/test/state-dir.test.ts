import { afterEach, describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { deviceServiceStateDir } from "../src/index.ts"

const dirs: string[] = []

// The discovery cases below read a real discovery file under a real temp dir. A simulated POSIX platform only accepts a
// POSIX-absolute state_dir, and a Windows temp path (C:\...) is not one, so those cases need a POSIX host; the simulated
// win32 cases accept a POSIX host's rooted temp path and run everywhere.
const posixHost = test.skipIf(process.platform === "win32")

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

const tempDir = (): string => {
  const dir = mkdtempSync(join(tmpdir(), "dss-"))
  dirs.push(dir)
  return dir
}

const writeLocation = (dir: string, body: string): void => {
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, "device-service.location.json"), body)
}

const location = (dir: string, state_dir: unknown = tempDir(), v: unknown = 1): string => {
  writeLocation(dir, JSON.stringify({ v, state_dir }))
  return String(state_dir)
}

describe("deviceServiceStateDir", () => {
  test("uses ~/.omo/device-service on POSIX and LOCALAPPDATA on Windows", () => {
    expect(deviceServiceStateDir("darwin", {}, "/Users/a")).toBe(join("/Users/a", ".omo", "device-service"))
    expect(deviceServiceStateDir("linux", { LOCALAPPDATA: "/ignored" }, "/home/a")).toBe(
      join("/home/a", ".omo", "device-service"),
    )
    expect(deviceServiceStateDir("win32", { LOCALAPPDATA: "C:\\Users\\a\\AppData\\Local" }, "C:\\Users\\a")).toBe(
      join("C:\\Users\\a\\AppData\\Local", "OmO", "device-service"),
    )
    expect(deviceServiceStateDir("win32", {}, "C:\\Users\\a")).toBe(
      join("C:\\Users\\a", "AppData", "Local", "OmO", "device-service"),
    )
  })

  // #13597: a device service run with a non-default --state-dir names it through the env var it sets on every
  // process it launches, or through the discovery file beside the default dir; anything unusable falls through.
  test("an absolute OMO_DEVICE_SERVICE_STATE_DIR wins over the discovery file and the default", () => {
    const home = tempDir()
    location(join(home, ".omo"))
    expect(deviceServiceStateDir("linux", { OMO_DEVICE_SERVICE_STATE_DIR: "/srv/ds-alt" }, home)).toBe("/srv/ds-alt")
  })

  test("an empty or relative OMO_DEVICE_SERVICE_STATE_DIR is ignored", () => {
    const home = tempDir()
    for (const value of ["", "ds-alt", "./ds-alt"])
      expect(deviceServiceStateDir("linux", { OMO_DEVICE_SERVICE_STATE_DIR: value }, home)).toBe(
        join(home, ".omo", "device-service"),
      )
    expect(deviceServiceStateDir("win32", { OMO_DEVICE_SERVICE_STATE_DIR: "C:ds-alt", LOCALAPPDATA: home }, home)).toBe(
      join(home, "OmO", "device-service"),
    )
  })

  posixHost("a relative OMO_DEVICE_SERVICE_STATE_DIR falls through to the discovery file", () => {
    const home = tempDir()
    const named = location(join(home, ".omo"))
    expect(deviceServiceStateDir("linux", { OMO_DEVICE_SERVICE_STATE_DIR: "ds-alt" }, home)).toBe(named)
  })

  posixHost("with no env var, the discovery file beside ~/.omo names the state dir on POSIX", () => {
    const home = tempDir()
    const posix = location(join(home, ".omo"))
    expect(deviceServiceStateDir("darwin", {}, home)).toBe(posix)
  })

  test("with no env var, the discovery file beside the Windows default dir names the state dir", () => {
    const home = tempDir()
    const localAppData = join(home, "Local")
    const windows = location(join(localAppData, "OmO"))
    expect(deviceServiceStateDir("win32", { LOCALAPPDATA: localAppData }, home)).toBe(windows)
    const fallback = location(join(home, "AppData", "Local", "OmO"))
    expect(deviceServiceStateDir("win32", {}, home)).toBe(fallback)
  })

  posixHost("a malformed, wrong-version, relative or dangling discovery file falls through to the default", () => {
    const entries: readonly ((dir: string) => void)[] = [
      (dir) => writeLocation(dir, "{not json"),
      (dir) => writeLocation(dir, "null"),
      (dir) => location(dir, tempDir(), 2),
      (dir) => location(dir, tempDir(), "1"),
      (dir) => location(dir, 42),
      (dir) => location(dir, "relative/state"),
      (dir) => location(dir, join(tempDir(), "missing")),
      (dir) => {
        const file = join(tempDir(), "a-file")
        writeFileSync(file, "")
        location(dir, file)
      },
    ]
    for (const write of entries) {
      const home = tempDir()
      write(join(home, ".omo"))
      expect(deviceServiceStateDir("linux", {}, home)).toBe(join(home, ".omo", "device-service"))
    }
  })
})
