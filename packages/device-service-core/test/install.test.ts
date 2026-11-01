import { afterEach, describe, expect, test } from "bun:test"
import { chmodSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { deviceServiceAssetName } from "../src/release/acquire.ts"
import { installDeviceService, type RunCommand } from "../src/install.ts"
import { buildRelease, ENGINE_VERSION, PIN_VERSION, RELEASE_ORIGIN, releaseKey, serveRelease } from "./release-fixture.ts"

const dirs: string[] = []
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

const HOST = "linux-arm64"

const setup = (minEngine?: string, exitCode = 0) => {
  const dir = mkdtempSync(join(tmpdir(), "dsi-"))
  chmodSync(dir, 0o700)
  dirs.push(dir)
  const key = releaseKey()
  const runs: (readonly string[])[] = []
  const run: RunCommand = async argv => {
    runs.push(argv)
    return { exitCode, output: exitCode === 0 ? "" : "install_failed {registration}" }
  }
  const stateDir = join(dir, "device-service")
  const options = {
    version: PIN_VERSION,
    host: HOST,
    stateDir,
    engineVersion: ENGINE_VERSION,
    origin: RELEASE_ORIGIN,
    releaseKey: key.publicHex,
    fetch: serveRelease(buildRelease({ key, host: HOST, ...(minEngine === undefined ? {} : { minEngine }) })).fetch,
    run,
  } as const
  return { options, runs, stateDir }
}

describe("installing the device service", () => {
  test("runs install-service --from the verified release directory", async () => {
    const { options, runs, stateDir } = setup()
    expect(await installDeviceService(options)).toEqual({ ok: true })
    const releaseDir = join(stateDir, "bin", PIN_VERSION)
    expect(runs).toEqual([[join(releaseDir, deviceServiceAssetName(HOST)), "install-service", "--from", releaseDir]])
  })

  test("a refused acquisition never runs a binary and carries the update action", async () => {
    const { options, runs } = setup("9.0.0")
    const outcome = await installDeviceService(options)
    expect(outcome).toMatchObject({ ok: false, state: "update_required" })
    expect(outcome.ok ? "" : outcome.action).toContain("Update OmO")
    expect(runs).toEqual([])
  })

  test("a failing install-service reports service_degraded with its output", async () => {
    const { options } = setup(undefined, 4)
    const outcome = await installDeviceService(options)
    expect(outcome).toMatchObject({ ok: false, state: "service_degraded" })
    expect(outcome.ok ? "" : outcome.action).toContain("install_failed {registration}")
  })
})
