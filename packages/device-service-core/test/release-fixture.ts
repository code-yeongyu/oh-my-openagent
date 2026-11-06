import { createHash, generateKeyPairSync, type KeyObject, sign } from "node:crypto"
import { type DeviceServiceHost, deviceServiceAssetName, type FetchRelease } from "../src/release/acquire.ts"

export const RELEASE_ORIGIN = "https://downloads.example.test"
export const PIN_VERSION = "1.4.0"
export const ENGINE_VERSION = "0.80.0"

const utf8 = (text: string): Uint8Array => new TextEncoder().encode(text)
const sha256 = (data: Uint8Array): string => createHash("sha256").update(data).digest("hex")

export type ReleaseKey = { readonly publicHex: string; readonly privateKey: KeyObject }

export const releaseKey = (): ReleaseKey => {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519")
  const x = publicKey.export({ format: "jwk" }).x ?? ""
  return { publicHex: Buffer.from(x, "base64url").toString("hex"), privateKey }
}

export type ReleaseOptions = {
  readonly key: ReleaseKey
  readonly host: DeviceServiceHost
  readonly version?: string
  readonly minEngine?: string
  readonly latest?: string
  readonly binary?: Uint8Array
  readonly tamperedBinary?: Uint8Array
  readonly signedBytes?: (checksums: Uint8Array) => Uint8Array
}

export const buildRelease = (options: ReleaseOptions): Map<string, Uint8Array> => {
  const version = options.version ?? PIN_VERSION
  const latest = utf8(options.latest ?? JSON.stringify({ version, min_engine_version: options.minEngine ?? "0.70.0" }))
  const binary = options.binary ?? utf8(`#!/bin/sh\necho device service ${version}\n`)
  const name = deviceServiceAssetName(options.host)
  const checksums = utf8(`${sha256(latest)}  latest.json\n${sha256(binary)}  ${name}\n`)
  const signature = sign(null, options.signedBytes?.(checksums) ?? checksums, options.key.privateKey)
  return new Map([
    ["checksums.txt", checksums],
    ["checksums.txt.sig", new Uint8Array(signature)],
    ["latest.json", latest],
    [name, options.tamperedBinary ?? binary],
  ])
}

export type ServedRelease = { readonly fetch: FetchRelease; readonly requested: string[] }

export const serveRelease = (files: ReadonlyMap<string, Uint8Array>, version = PIN_VERSION, channel = "stable"): ServedRelease => {
  const requested: string[] = []
  const prefix = `${RELEASE_ORIGIN}/${channel}/device-service/${version}/`
  return {
    requested,
    fetch: async url => {
      requested.push(url)
      const body = url.startsWith(prefix) ? files.get(url.slice(prefix.length)) : undefined
      return body === undefined ? new Response("not found", { status: 404 }) : new Response(new Uint8Array(body))
    },
  }
}
