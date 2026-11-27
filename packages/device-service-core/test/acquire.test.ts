import { afterEach, describe, expect, test } from "bun:test"
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
} from "node:fs"
import { sign } from "node:crypto"
import { tmpdir } from "node:os"
import { join } from "node:path"
import corpus from "../src/strict-ed25519/strict-ed25519-corpus.json"
import {
  acquireDeviceService,
  type AcquireOptions,
  DEVICE_SERVICE_RELEASE_KEYS,
  deviceServiceAssetName,
  type FetchRelease,
  verifyReleaseSignature,
} from "../src/release/acquire.ts"
import { parseReleaseKeySet } from "../src/release/release-signature.ts"
import {
  buildRelease,
  ENGINE_VERSION,
  PIN_VERSION,
  RELEASE_ORIGIN,
  releaseKey,
  serveRelease,
} from "./release-fixture.ts"
import { fakeClock } from "./local-api/conformance/fake-clock.ts"
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
const options = (
  state: string,
  served: ReturnType<typeof serveRelease>,
  publicHex: string,
  extra: Partial<AcquireOptions> = {},
): AcquireOptions => ({
  version: PIN_VERSION,
  host: HOST,
  stateDir: state,
  engineVersion: ENGINE_VERSION,
  origin: RELEASE_ORIGIN,
  releaseKeys: [publicHex],
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
    expect(result).toEqual({
      ok: true,
      version: PIN_VERSION,
      releaseDir,
      binary: join(releaseDir, deviceServiceAssetName(HOST)),
    })
    expect(readdirSync(releaseDir).toSorted()).toEqual(
      ["checksums.txt", "checksums.txt.sig", "latest.json", deviceServiceAssetName(HOST)].toSorted(),
    )
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
    expect(await verifyReleaseSignature([bytes(key.publicHex)], signature, checksums)).toEqual({
      ok: false,
      refusal: "signature",
    })

    const state = stateDir()
    const served = serveRelease(release)
    expect(await acquireDeviceService(options(state, served, key.publicHex))).toMatchObject({
      ok: false,
      refusal: "signature",
    })
    expect(existsSync(state)).toBe(false)
    expect(served.requested.some((url) => url.endsWith(deviceServiceAssetName(HOST)))).toBe(false)
  })

  test("a release signed by a key outside the two-key set is refused as signature and nothing is written", async () => {
    const operational = releaseKey()
    const recovery = releaseKey()
    const outsider = releaseKey()
    const state = stateDir()
    const served = serveRelease(buildRelease({ key: outsider, host: HOST }))
    const result = await acquireDeviceService({
      ...options(state, served, ""),
      releaseKeys: [operational.publicHex, recovery.publicHex],
    })
    expect(result).toMatchObject({ ok: false, refusal: "signature" })
    expect(existsSync(state)).toBe(false)
    expect(served.requested.some((url) => url.endsWith(deviceServiceAssetName(HOST)))).toBe(false)
  })

  test("identity-point release key and identity signature are refused", async () => {
    const identity = corpus.ed25519[0]
    expect(identity?.id).toBe("SE1")
    const key = bytes(identity?.key ?? "")
    const signature = bytes(identity?.sig ?? "")
    const checksums = buildRelease({ key: releaseKey(), host: HOST }).get("checksums.txt") ?? new Uint8Array()

    expect(await verifyReleaseSignature([key], signature, checksums)).toEqual({ ok: false, refusal: "malformed" })
    expect(await nativeEd25519Verify(key, signature, new Uint8Array(checksums))).toBe(true)

    const state = stateDir()
    const served = serveRelease(new Map())
    expect(await acquireDeviceService(options(state, served, identity?.key ?? ""))).toMatchObject({
      ok: false,
      refusal: "release_key_invalid",
    })
    expect(served.requested).toEqual([])
    expect(existsSync(state)).toBe(false)
  })

  test("S >= L refused (SE4): the same signature with S + L is malformed", async () => {
    const key = releaseKey()
    const release = buildRelease({ key, host: HOST })
    const checksums = release.get("checksums.txt") ?? new Uint8Array()
    const signature = release.get("checksums.txt.sig") ?? new Uint8Array()
    expect(await verifyReleaseSignature([bytes(key.publicHex)], signature, checksums)).toEqual({ ok: true })

    const malleated = new Uint8Array([...signature.slice(0, 32), ...scalarBytes(scalar(signature.slice(32)) + L)])
    expect(await verifyReleaseSignature([bytes(key.publicHex)], malleated, checksums)).toEqual({
      ok: false,
      refusal: "malformed",
    })
    const state = stateDir()
    const served = serveRelease(new Map([...release, ["checksums.txt.sig", malleated]]))
    expect(await acquireDeviceService(options(state, served, key.publicHex))).toMatchObject({
      ok: false,
      refusal: "malformed",
    })
    expect(existsSync(state)).toBe(false)
  })

  test("the compiled-in key set is the service's release-key.json parsed strictly: the minted operational and recovery keys, both strict, so acquisition goes past the key check", async () => {
    // #12580 item 1: the published set, in order. Comparing against the same release-key.json it is parsed from passed
    // for any other two strict keys and for a swap, so the check has to name the two hex values themselves.
    expect(DEVICE_SERVICE_RELEASE_KEYS).toEqual([
      "6c6781a91888e3e5be10d1b27466319a7d5adf2a7d2b254f4118eda9cbcb4465",
      "ca9407b484a30ac7f09cb152455176f1e03fc6ca3446ff930bc7587215759016",
    ])
    const state = stateDir()
    const served = serveRelease(new Map())
    const { releaseKeys: _unused, ...defaults } = options(state, served, "")
    const result = await acquireDeviceService(defaults)
    expect(result).not.toMatchObject({ refusal: "release_key_invalid" })
    expect(served.requested.length).toBeGreaterThan(0)
  })

  test("a release signed by either key of the set installs: the recovery key verifies when the operational key did not sign", async () => {
    const operational = releaseKey()
    const recovery = releaseKey()
    const state = stateDir()
    const served = serveRelease(buildRelease({ key: recovery, host: HOST }))
    const result = await acquireDeviceService({
      ...options(state, served, ""),
      releaseKeys: [operational.publicHex, recovery.publicHex],
    })
    expect(result).toMatchObject({ ok: true, version: PIN_VERSION })
  })

  test("a set holding the placeholder next to a real key, or repeating a key, is refused before any download and names a build defect instead of an update", async () => {
    const key = releaseKey()
    for (const releaseKeys of [[key.publicHex, "00".repeat(32)], [key.publicHex, key.publicHex], []]) {
      const state = stateDir()
      const served = serveRelease(buildRelease({ key, host: HOST }))
      const result = await acquireDeviceService({ ...options(state, served, ""), releaseKeys })
      expect(result).toMatchObject({ ok: false, refusal: "release_key_invalid" })
      expect(result.ok ? "" : result.action).toBe(
        "This omo build carries no usable device service release key, so it cannot verify device service releases. That is a defect in this build: report it with /bug.",
      )
      expect(served.requested).toEqual([])
    }
  })

  test("release-key.json is parsed by the service's rules: another field, another alg, a repeated key or a non-lowercase key is refused", () => {
    const hex = "ab".repeat(32)
    expect(parseReleaseKeySet({ alg: "Ed25519", public_keys_hex: [hex] })).toEqual([hex])
    for (const bad of [
      { alg: "Ed25519", public_keys_hex: [hex], key_ids: ["a"] },
      { alg: "Ed448", public_keys_hex: [hex] },
      { alg: "Ed25519", public_keys_hex: [hex, hex] },
      { alg: "Ed25519", public_keys_hex: [hex.toUpperCase()] },
      { alg: "Ed25519", public_keys_hex: hex },
    ])
      expect(() => parseReleaseKeySet(bad)).toThrow()
  })

  // #12656: an origin that has never published the pinned release answers 404 for every file of it. That is not a
  // connection problem, so it is its own refusal; a transport failure, a 5xx or a half-published release still is one.
  test("a release that was never published (404 for every file) is refused as not_published and nothing is written", async () => {
    const state = stateDir()
    const served = serveRelease(new Map())
    const result = await acquireDeviceService(options(state, served, releaseKey().publicHex))
    expect(result).toMatchObject({ ok: false, refusal: "not_published" })
    expect(result.ok ? "" : result.action).not.toContain("connection")
    expect(served.requested.some((url) => url.endsWith(deviceServiceAssetName(HOST)))).toBe(false)
    expect(existsSync(state)).toBe(false)
  })

  test.each([
    [
      "a fetch that throws",
      async (): Promise<Response> => {
        throw new TypeError("fetch failed")
      },
    ],
    ["a 503", async (): Promise<Response> => new Response("unavailable", { status: 503 })],
  ])("%s is still download_failed with the connection action", async (_name, fetch) => {
    const state = stateDir()
    const result = await acquireDeviceService(
      options(state, serveRelease(new Map()), releaseKey().publicHex, { fetch }),
    )
    expect(result).toEqual({
      ok: false,
      refusal: "download_failed",
      action: "Could not download the OmO device service. Check the connection and try again.",
    })
    expect(existsSync(state)).toBe(false)
  })

  // not_published needs BOTH signed entry files to answer 404; a 404 on only one of them is a broken release.
  test.each([
    ["the binary", deviceServiceAssetName(HOST)],
    ["only checksums.txt", "checksums.txt"],
    ["only checksums.txt.sig", "checksums.txt.sig"],
  ])("a half-published release (%s 404) is download_failed, not not_published", async (_name, missing) => {
    const key = releaseKey()
    const files = buildRelease({ key, host: HOST })
    files.delete(missing)
    const state = stateDir()
    expect(await acquireDeviceService(options(state, serveRelease(files), key.publicHex))).toMatchObject({
      ok: false,
      refusal: "download_failed",
    })
    expect(existsSync(state)).toBe(false)
  })

  test("checksum mismatch aborts before any write", async () => {
    const key = releaseKey()
    const state = stateDir()
    const served = serveRelease(
      buildRelease({ key, host: HOST, tamperedBinary: new TextEncoder().encode("not the release") }),
    )
    expect(await acquireDeviceService(options(state, served, key.publicHex))).toMatchObject({
      ok: false,
      refusal: "checksum",
    })
    expect(existsSync(state)).toBe(false)
  })

  test("a latest.json that is not the one checksums.txt signed aborts before any write", async () => {
    const key = releaseKey()
    const state = stateDir()
    const files = buildRelease({ key, host: HOST })
    files.set(
      "latest.json",
      new TextEncoder().encode(JSON.stringify({ version: PIN_VERSION, min_engine_version: "0.1.0" })),
    )
    expect(await acquireDeviceService(options(state, serveRelease(files), key.publicHex))).toMatchObject({
      ok: false,
      refusal: "checksum",
    })
    expect(existsSync(state)).toBe(false)
  })

  test("a signed checksums.txt that names a file outside the release is malformed", async () => {
    const key = releaseKey()
    const files = buildRelease({ key, host: HOST })
    const checksums = new Uint8Array([
      ...(files.get("checksums.txt") ?? []),
      ...new TextEncoder().encode(`${"0".repeat(64)}  install.sh\n`),
    ])
    files.set("checksums.txt", checksums)
    files.set("checksums.txt.sig", new Uint8Array(sign(null, checksums, key.privateKey)))
    const state = stateDir()
    expect(await acquireDeviceService(options(state, serveRelease(files), key.publicHex))).toMatchObject({
      ok: false,
      refusal: "malformed",
    })
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
    const served = serveRelease(
      buildRelease({ key, host: HOST, latest: JSON.stringify({ version: "1.3.9", min_engine_version: "0.70.0" }) }),
    )
    expect(await acquireDeviceService(options(state, served, key.publicHex))).toMatchObject({
      ok: false,
      refusal: "version_mismatch",
    })
    expect(existsSync(state)).toBe(false)
  })

  test.each([
    [
      "a signature that is not 64 bytes",
      (files: Map<string, Uint8Array>) => files.set("checksums.txt.sig", new Uint8Array(63)),
    ],
    [
      "a latest.json with an extra field",
      (files: Map<string, Uint8Array>, key: ReturnType<typeof releaseKey>) => {
        for (const [name, content] of buildRelease({
          key,
          host: HOST,
          latest: JSON.stringify({ version: PIN_VERSION, min_engine_version: "0.70.0", url: "x" }),
        }))
          files.set(name, content)
      },
    ],
  ])("%s is malformed", async (_name, tamper) => {
    const key = releaseKey()
    const files = buildRelease({ key, host: HOST })
    tamper(files, key)
    const state = stateDir()
    expect(await acquireDeviceService(options(state, serveRelease(files), key.publicHex))).toMatchObject({
      ok: false,
      refusal: "malformed",
    })
    expect(existsSync(state)).toBe(false)
  })

  test.skipIf(process.platform === "win32")(
    "an existing state dir open to others is made private before the release is written",
    async () => {
      const key = releaseKey()
      const state = stateDir()
      mkdirSync(state, { mode: 0o755 })
      chmodSync(state, 0o755)
      expect(
        await acquireDeviceService(options(state, serveRelease(buildRelease({ key, host: HOST })), key.publicHex)),
      ).toMatchObject({ ok: true })
      expect(statSync(state).mode & 0o777).toBe(0o700)
      expect(statSync(join(state, "bin")).mode & 0o777).toBe(0o700)
    },
  )

  test.skipIf(process.platform === "win32")(
    "a state dir that is a symlink is refused and nothing lands behind it",
    async () => {
      const key = releaseKey()
      const state = stateDir()
      const target = `${state}-target`
      mkdirSync(target, { mode: 0o700 })
      symlinkSync(target, state)
      const failure = await acquireDeviceService(
        options(state, serveRelease(buildRelease({ key, host: HOST })), key.publicHex),
      ).then(
        () => undefined,
        (error: unknown) => error,
      )
      expect(failure).toMatchObject({ code: "insecure_state_dir" })
      expect(readdirSync(target)).toEqual([])
    },
  )

  test("a macOS binary is installed only when its code signature passes, checked before it is renamed into place", async () => {
    const key = releaseKey()
    const host = "darwin-arm64"
    const checked: string[] = []
    const refusedState = stateDir()
    const refused = await acquireDeviceService(
      options(refusedState, serveRelease(buildRelease({ key, host })), key.publicHex, {
        host,
        verifyCodeSignature: (path) => (checked.push(path), false),
      }),
    )
    expect(refused).toMatchObject({ ok: false, refusal: "code_signature" })
    expect(checked).toHaveLength(1)
    expect(checked[0]?.startsWith(join(refusedState, "bin", PIN_VERSION))).toBe(false)
    expect(existsSync(join(refusedState, "bin", PIN_VERSION))).toBe(false)
    expect(readdirSync(join(refusedState, "bin"))).toEqual([])

    const passedState = stateDir()
    const passed = await acquireDeviceService(
      options(passedState, serveRelease(buildRelease({ key, host })), key.publicHex, {
        host,
        verifyCodeSignature: () => true,
      }),
    )
    expect(passed).toMatchObject({
      ok: true,
      binary: join(passedState, "bin", PIN_VERSION, deviceServiceAssetName(host)),
    })
  })
})

// #13223/#13224: the downloader's body read. A timeout or reset while the ~90 MB binary streams, a link slower than
// the old 120 s total budget, and a body cut short of its content-length are all download failures — never an
// uncaught exception, never a fixed total cap on a progressing link, never a checksum verdict on a broken transfer.
describe("download body failures and stall bounds (#13223, #13224)", () => {
  const binaryName = deviceServiceAssetName(HOST)

  const entryFilesWithoutBinary = (release: ReadonlyMap<string, Uint8Array>): ReadonlyMap<string, Uint8Array> =>
    new Map([...release].filter(([name]) => name !== binaryName))

  // A circuit breaker, not a synchronization primitive: on the broken base nothing settles and the test fails here.
  const settleWithin = async <T>(pending: Promise<T>, what: string): Promise<T> =>
    Promise.race([
      pending,
      new Promise<never>((_, reject) => {
        const breaker = setTimeout(() => reject(new Error(`circuit breaker: waited 2s for ${what}`)), 2_000)
        breaker.unref?.()
      }),
    ])

  // One pump round: enough microtask turns for the downloader's read loop, plus one zero-delay event-loop turn for
  // the buffered entry-file reads the runtime resolves there. This is ordering, not waiting: nothing ever sleeps for a
  // duration, and a download that cannot settle still trips the circuit breaker.
  const pump = async (): Promise<void> => {
    for (let step = 0; step < 8; step++) await Promise.resolve()
    await new Promise((resolve) => setTimeout(resolve, 0))
  }

  test("a body read that times out mid-stream resolves as download_failed, not an uncaught TimeoutError", async () => {
    const key = releaseKey()
    const release = buildRelease({ key, host: HOST })
    const served = serveRelease(entryFilesWithoutBinary(release))
    const fetchTimedOutBody: FetchRelease = (url, init) =>
      url.endsWith(binaryName)
        ? Promise.resolve(
            new Response(
              new ReadableStream<Uint8Array>({
                start(controller) {
                  controller.enqueue(new Uint8Array(1024))
                  controller.error(new DOMException("The operation timed out.", "TimeoutError"))
                },
              }),
            ),
          )
        : served.fetch(url, init)
    const state = stateDir()

    const result = await settleWithin(
      acquireDeviceService(options(state, served, key.publicHex, { fetch: fetchTimedOutBody })),
      "the timed-out body read to be refused",
    )

    expect(result).toEqual({
      ok: false,
      refusal: "download_failed",
      action: "Could not download the OmO device service. Check the connection and try again.",
    })
    expect(existsSync(state)).toBe(false)
  })

  // A body whose length disagrees with its declared content-length, either way, and an empty body, are broken
  // transfers: none reaches the checksum step (#13224; review of efcaf83982, LOW 1).
  const brokenBodies: readonly {
    readonly name: string
    readonly response: (binary: Uint8Array) => Response
  }[] = [
    {
      name: "a body shorter than its declared content-length",
      response: (binary) =>
        new Response(binary.slice(0, Math.ceil(binary.byteLength / 2)), {
          headers: { "content-length": String(binary.byteLength) },
        }),
    },
    {
      name: "a body longer than its declared content-length",
      response: (binary) =>
        new Response(new Uint8Array([...binary, 0, 1, 2]), {
          headers: { "content-length": String(binary.byteLength) },
        }),
    },
    { name: "an empty body with no content-length", response: () => new Response(new Uint8Array()) },
  ]
  for (const { name, response } of brokenBodies)
    test(`${name} is download_failed, not checksum`, async () => {
      const key = releaseKey()
      const release = buildRelease({ key, host: HOST })
      const binary = release.get(binaryName) ?? new Uint8Array()
      const served = serveRelease(entryFilesWithoutBinary(release))
      const fetchBroken: FetchRelease = (url, init) =>
        url.endsWith(binaryName) ? Promise.resolve(response(binary)) : served.fetch(url, init)
      const state = stateDir()

      const result = await acquireDeviceService(options(state, served, key.publicHex, { fetch: fetchBroken }))

      expect(result).toEqual({
        ok: false,
        refusal: "download_failed",
        action: "Could not download the OmO device service. Check the connection and try again.",
      })
      expect(existsSync(state)).toBe(false)
    })

  // The bound is a stall, not a total transfer deadline: four chunks, one every 30 s of the virtual clock, finish at
  // 150 s — past the old fixed 120 s cap — and must still install.
  test("a slow but steady stream installs past the old 120 s total cap on the virtual clock", async () => {
    const key = releaseKey()
    const release = buildRelease({ key, host: HOST })
    const binary = release.get(binaryName) ?? new Uint8Array()
    const served = serveRelease(entryFilesWithoutBinary(release))
    const clock = fakeClock()
    const started = clock.now()
    const chunks = 4
    const chunkSize = Math.ceil(binary.byteLength / chunks)
    const fetchPaced: FetchRelease = (url, init) =>
      url.endsWith(binaryName)
        ? Promise.resolve(
            new Response(
              new ReadableStream<Uint8Array>({
                start(controller) {
                  for (let index = 0; index < chunks; index++)
                    clock.after((index + 1) * 30_000, () =>
                      controller.enqueue(binary.slice(index * chunkSize, (index + 1) * chunkSize)),
                    )
                  clock.after((chunks + 1) * 30_000, () => controller.close())
                },
              }),
            ),
          )
        : served.fetch(url, init)
    const state = stateDir()

    const pending = acquireDeviceService(options(state, served, key.publicHex, { fetch: fetchPaced, timers: clock }))
    // The pipeline's own awaits (signature verification sits between the entry files and the binary) consume real
    // event-loop turns before the paced stream arms, so drive virtual 30 s ticks until the download settles.
    for (let tick = 0; tick < 20; tick++) {
      clock.advance(30_000)
      await pump()
    }
    const result = await settleWithin(pending, "the paced download to install")

    expect(result).toMatchObject({ ok: true, version: PIN_VERSION })
    expect(clock.now() - started).toBeGreaterThan(120_000)
    expect(existsSync(join(state, "bin", PIN_VERSION, binaryName))).toBe(true)
  })

  test("a stalled body aborts as download_failed once no bytes arrive for the stall budget", async () => {
    const key = releaseKey()
    const release = buildRelease({ key, host: HOST })
    const binary = release.get(binaryName) ?? new Uint8Array()
    const served = serveRelease(entryFilesWithoutBinary(release))
    const clock = fakeClock()
    const fetchStalled: FetchRelease = (url, init) =>
      url.endsWith(binaryName)
        ? Promise.resolve(
            new Response(
              new ReadableStream<Uint8Array>({
                start(controller) {
                  controller.enqueue(binary.slice(0, 1))
                },
              }),
            ),
          )
        : served.fetch(url, init)
    const state = stateDir()

    const pending = acquireDeviceService(options(state, served, key.publicHex, { fetch: fetchStalled, timers: clock }))
    for (let tick = 0; tick < 8; tick++) {
      clock.advance(30_000)
      await pump()
    }
    const result = await settleWithin(pending, "the stalled download to be refused")

    expect(result).toEqual({
      ok: false,
      refusal: "download_failed",
      action: "Could not download the OmO device service. Check the connection and try again.",
    })
    expect(existsSync(state)).toBe(false)
  })
})
