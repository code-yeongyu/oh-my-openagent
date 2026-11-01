import { afterEach, describe, expect, test } from "bun:test"
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, symlinkSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import corpus from "../src/strict-ed25519/strict-ed25519-corpus.json"
import { strictEd25519Key } from "../src/strict-ed25519/strict-ed25519.ts"
import {
  acquireDeviceService,
  type AcquireOptions,
  DEVICE_SERVICE_RELEASE_KEY,
  deviceServiceAssetName,
  verifyReleaseSignature,
} from "../src/release/acquire.ts"
import { buildRelease, ENGINE_VERSION, PIN_VERSION, RELEASE_ORIGIN, releaseKey, serveRelease } from "./release-fixture.ts"
import { nativeEd25519Verify } from "./strict-ed25519/native-control.ts"

const dirs: string[] = []
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

const stateDir = (): string => {
  const dir = mkdtempSync(join(tmpdir(), "dsa-"))
  chmodSync(dir, 0o700)
  dirs.push(dir)
  return join(dir, "device-service")
}

const bytes = (hex: string): Uint8Array<ArrayBuffer> => new Uint8Array(Buffer.from(hex, "hex"))
const L = (1n << 252n) + 27742317777372353535851937790883648493n
const scalar = (le: Uint8Array): bigint => BigInt(`0x${Buffer.from(le).reverse().toString("hex") || "0"}`)
const scalarBytes = (value: bigint): Uint8Array => Buffer.from(value.toString(16).padStart(64, "0"), "hex").reverse()

const HOST = "linux-x64"
const options = (state: string, served: ReturnType<typeof serveRelease>, publicHex: string, extra: Partial<AcquireOptions> = {}): AcquireOptions => ({
  version: PIN_VERSION,
  host: HOST,
  stateDir: state,
  engineVersion: ENGINE_VERSION,
  origin: RELEASE_ORIGIN,
  releaseKey: publicHex,
  fetch: served.fetch,
  ...extra,
})

describe("verified acquisition of the device service", () => {
  test("verified install: manifest, checksum, signature and min_engine_version pass, and the release lands in bin/<version>", async () => {
    const key = releaseKey()
    const release = buildRelease({ key, host: HOST })
    const served = serveRelease(release)
    const state = stateDir()

    const result = await acquireDeviceService(options(state, served, key.publicHex))

    const releaseDir = join(state, "bin", PIN_VERSION)
    expect(result).toEqual({ ok: true, version: PIN_VERSION, releaseDir, binary: join(releaseDir, deviceServiceAssetName(HOST)) })
    expect(readdirSync(releaseDir).toSorted()).toEqual(["checksums.txt", "checksums.txt.sig", "latest.json", deviceServiceAssetName(HOST)].toSorted())
    for (const [name, content] of release) expect(Buffer.compare(readFileSync(join(releaseDir, name)), content)).toBe(0)
    expect(readdirSync(join(state, "bin"))).toEqual([PIN_VERSION])
    if (process.platform !== "win32") {
      expect(statSync(join(releaseDir, deviceServiceAssetName(HOST))).mode & 0o777).toBe(0o755)
      expect(statSync(state).mode & 0o077).toBe(0)
    }
  })

  test("bad signature aborts: a valid key over other bytes is refused as signature and nothing is written", async () => {
    const key = releaseKey()
    const release = buildRelease({ key, host: HOST, signedBytes: () => new TextEncoder().encode("other bytes") })
    const checksums = release.get("checksums.txt") ?? new Uint8Array()
    const signature = release.get("checksums.txt.sig") ?? new Uint8Array()
    expect(await verifyReleaseSignature(bytes(key.publicHex), signature, checksums)).toEqual({ ok: false, refusal: "signature" })

    const state = stateDir()
    const served = serveRelease(release)
    expect(await acquireDeviceService(options(state, served, key.publicHex))).toMatchObject({ ok: false, refusal: "signature" })
    expect(existsSync(state)).toBe(false)
    expect(served.requested.some(url => url.endsWith(deviceServiceAssetName(HOST)))).toBe(false)
  })

  test("identity-point release key and identity signature are refused", async () => {
    const identity = corpus.ed25519[0]
    expect(identity?.id).toBe("SE1")
    const key = bytes(identity?.key ?? "")
    const signature = bytes(identity?.sig ?? "")
    const checksums = buildRelease({ key: releaseKey(), host: HOST }).get("checksums.txt") ?? new Uint8Array()

    expect(await verifyReleaseSignature(key, signature, checksums)).toEqual({ ok: false, refusal: "malformed" })
    expect(await nativeEd25519Verify(key, signature, new Uint8Array(checksums))).toBe(true)

    const state = stateDir()
    const served = serveRelease(new Map())
    expect(await acquireDeviceService(options(state, served, identity?.key ?? ""))).toMatchObject({ ok: false, refusal: "release_key_invalid" })
    expect(served.requested).toEqual([])
    expect(existsSync(state)).toBe(false)
  })

  test("S >= L refused (SE4): the same signature with S + L is malformed", async () => {
    const key = releaseKey()
    const release = buildRelease({ key, host: HOST })
    const checksums = release.get("checksums.txt") ?? new Uint8Array()
    const signature = release.get("checksums.txt.sig") ?? new Uint8Array()
    expect(await verifyReleaseSignature(bytes(key.publicHex), signature, checksums)).toEqual({ ok: true })

    const malleated = new Uint8Array([...signature.slice(0, 32), ...scalarBytes(scalar(signature.slice(32)) + L)])
    expect(await verifyReleaseSignature(bytes(key.publicHex), malleated, checksums)).toEqual({ ok: false, refusal: "malformed" })
    const state = stateDir()
    const served = serveRelease(new Map([...release, ["checksums.txt.sig", malleated]]))
    expect(await acquireDeviceService(options(state, served, key.publicHex))).toMatchObject({ ok: false, refusal: "malformed" })
    expect(existsSync(state)).toBe(false)
  })

  test("the compiled-in release key is the refusing placeholder, so the default acquisition stops before any download", async () => {
    expect(DEVICE_SERVICE_RELEASE_KEY).toBe("00".repeat(32))
    expect(strictEd25519Key(bytes(DEVICE_SERVICE_RELEASE_KEY))).toBe(false)
    const state = stateDir()
    const served = serveRelease(new Map())
    const { releaseKey: _unused, ...defaults } = options(state, served, "")
    expect(await acquireDeviceService(defaults)).toMatchObject({ ok: false, refusal: "release_key_invalid" })
    expect(served.requested).toEqual([])
  })

  test("checksum mismatch aborts before any write", async () => {
    const key = releaseKey()
    const state = stateDir()
    const served = serveRelease(buildRelease({ key, host: HOST, tamperedBinary: new TextEncoder().encode("not the release") }))
    expect(await acquireDeviceService(options(state, served, key.publicHex))).toMatchObject({ ok: false, refusal: "checksum" })
    expect(existsSync(state)).toBe(false)
  })

  test("min_engine_version newer than the bundled engine refuses with the update hint and installs nothing", async () => {
    const key = releaseKey()
    const state = stateDir()
    const served = serveRelease(buildRelease({ key, host: HOST, minEngine: "0.81.0" }))
    const result = await acquireDeviceService(options(state, served, key.publicHex))
    expect(result).toMatchObject({ ok: false, refusal: "update_required" })
    expect(result.ok ? "" : result.action).toContain("Update OmO")
    expect(existsSync(state)).toBe(false)
  })

  test("a signed latest.json for another version than the pin is refused", async () => {
    const key = releaseKey()
    const state = stateDir()
    const served = serveRelease(buildRelease({ key, host: HOST, latest: JSON.stringify({ version: "1.3.9", min_engine_version: "0.70.0" }) }))
    expect(await acquireDeviceService(options(state, served, key.publicHex))).toMatchObject({ ok: false, refusal: "version_mismatch" })
    expect(existsSync(state)).toBe(false)
  })

  test.each([
    ["a signature that is not 64 bytes", (files: Map<string, Uint8Array>) => files.set("checksums.txt.sig", new Uint8Array(63))],
    ["a latest.json with an extra field", (files: Map<string, Uint8Array>, key: ReturnType<typeof releaseKey>) => {
      for (const [name, content] of buildRelease({ key, host: HOST, latest: JSON.stringify({ version: PIN_VERSION, min_engine_version: "0.70.0", url: "x" }) })) files.set(name, content)
    }],
  ])("%s is malformed", async (_name, tamper) => {
    const key = releaseKey()
    const files = buildRelease({ key, host: HOST })
    tamper(files, key)
    const state = stateDir()
    expect(await acquireDeviceService(options(state, serveRelease(files), key.publicHex))).toMatchObject({ ok: false, refusal: "malformed" })
    expect(existsSync(state)).toBe(false)
  })

  test.skipIf(process.platform === "win32")("an existing state dir open to others is made private before the release is written", async () => {
    const key = releaseKey()
    const state = stateDir()
    mkdirSync(state, { mode: 0o755 })
    chmodSync(state, 0o755)
    expect(await acquireDeviceService(options(state, serveRelease(buildRelease({ key, host: HOST })), key.publicHex))).toMatchObject({ ok: true })
    expect(statSync(state).mode & 0o777).toBe(0o700)
    expect(statSync(join(state, "bin")).mode & 0o777).toBe(0o700)
  })

  test.skipIf(process.platform === "win32")("a state dir that is a symlink is refused and nothing lands behind it", async () => {
    const key = releaseKey()
    const state = stateDir()
    const target = `${state}-target`
    mkdirSync(target, { mode: 0o700 })
    symlinkSync(target, state)
    const failure = await acquireDeviceService(options(state, serveRelease(buildRelease({ key, host: HOST })), key.publicHex)).then(
      () => undefined,
      (error: unknown) => error,
    )
    expect(failure).toMatchObject({ code: "insecure_state_dir" })
    expect(readdirSync(target)).toEqual([])
  })

  test("a macOS binary is installed only when its code signature passes, checked before it is renamed into place", async () => {
    const key = releaseKey()
    const host = "darwin-arm64"
    const checked: string[] = []
    const refusedState = stateDir()
    const refused = await acquireDeviceService(
      options(refusedState, serveRelease(buildRelease({ key, host })), key.publicHex, { host, verifyCodeSignature: path => (checked.push(path), false) }),
    )
    expect(refused).toMatchObject({ ok: false, refusal: "code_signature" })
    expect(checked).toHaveLength(1)
    expect(checked[0]?.startsWith(join(refusedState, "bin", PIN_VERSION))).toBe(false)
    expect(existsSync(join(refusedState, "bin", PIN_VERSION))).toBe(false)
    expect(readdirSync(join(refusedState, "bin"))).toEqual([])

    const passedState = stateDir()
    const passed = await acquireDeviceService(
      options(passedState, serveRelease(buildRelease({ key, host })), key.publicHex, { host, verifyCodeSignature: () => true }),
    )
    expect(passed).toMatchObject({ ok: true, binary: join(passedState, "bin", PIN_VERSION, deviceServiceAssetName(host)) })
  })
})
