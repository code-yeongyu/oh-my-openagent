#!/usr/bin/env bun
// #14916 key-embedding generator: rewrites the compiled-in release-key constants in install.sh (and install.ps1's
// block once its verifier lands) from packages/release-signing/keys/release-keys.json. The LEAD runs this when
// landing the real public keys with V_SIGN; the drift tests fail CI whenever the embedded constants and the JSON
// disagree. --check only verifies (exit 1 on drift); the default writes.
import { createPublicKey } from "node:crypto"
import { readFileSync, writeFileSync } from "node:fs"
import { minisignKeyidOf } from "@oh-my-opencode/release-signing/minisign"
import keysFile from "../../packages/release-signing/keys/release-keys.json"

const hexes: readonly string[] = keysFile.public_keys_hex
const vSign: string | null = keysFile.v_sign
const PKCS8 = Buffer.from("302e020100300506032b657004220420", "hex")

const pkPem = (hex: string): string => {
  const spki = Buffer.concat([Buffer.from("302a300506032b6570032100", "hex"), Buffer.from(hex, "hex")])
  return createPublicKey({ key: spki, format: "der", type: "spki" }).export({ format: "pem", type: "spki" }).toString().trim()
}

const lines = hexes.map((hex) => {
  const keyid = Buffer.from(minisignKeyidOf(Buffer.from(hex, "hex"))).toString("hex")
  const spki = createPublicKey({ key: Buffer.concat([Buffer.from("302a300506032b6570032100", "hex"), Buffer.from(hex, "hex")]), format: "der", type: "spki" })
    .export({ format: "der", type: "spki" })
    .toString("base64")
  return `${keyid}|${spki}`
})

const SH_PATH = "packages/get-worker/scripts/install.sh"
const sh = readFileSync(SH_PATH, "utf8")
const next = `OMO_RELEASE_KEYS='${lines.join("\n")}'\nOMO_RELEASE_V_SIGN='${vSign ?? ""}'`
const current = /OMO_RELEASE_KEYS='[^']*'\nOMO_RELEASE_V_SIGN='[^']*'/.exec(sh)
if (current === null) throw new Error("install.sh lost its release-signature constant block")
if (process.argv.includes("--check")) {
  if (current[0] !== next) {
    console.error("drift: install.sh constants do not match keys/release-keys.json")
    process.exit(1)
  }
  console.log("ok: install.sh constants match keys/release-keys.json")
  process.exit(0)
}
writeFileSync(SH_PATH, sh.replace(current[0], next))
console.log(`generate-installer-keys: rewrote ${SH_PATH} (${lines.length} key(s), v_sign=${vSign ?? "inactive"})`)
