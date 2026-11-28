import { describe, expect, test } from "bun:test"
import { createHash, createPrivateKey, createPublicKey } from "node:crypto"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { spawnSync } from "node:child_process"
import { afterEach } from "bun:test"

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})
import { publicKeyOfSeed, signMinisignEd } from "../../../packages/release-signing/src/sign.ts"
import { minisignKeyidOf, type MinisignPublicKey } from "../../../packages/release-signing/src/minisign.ts"
import vectors from "../../../packages/release-signing/test/vectors/shared-vectors.json"

// #14916: the install.sh signature gate, driven as the real surface (bash executing the script's own functions).
// This is also the shell leg of the cross-surface agreement test: the SAME shared vector file the TS verifier runs
// must produce identical verdicts through the shell verifier (keyring delta read items 2-3).
const script = readFileSync(join(import.meta.dir, "..", "scripts", "install.sh"), "utf8")
const roots: string[] = []

function functionSource(name: string): string {
  const start = script.indexOf(`\n${name}() {`)
  const end = script.indexOf("\n}\n", start)
  if (start < 0 || end < 0) throw new Error(`install.sh has no ${name}()`)
  return script.slice(start + 1, end + 2)
}

const PRELUDE = (keys: string, vSign: string): string =>
  [
    "set -euo pipefail",
    "say() { printf '%s\\n' \"$*\" >&2; }",
    "fail() { say \"omo installer: $*\"; exit 1; }",
    `OMO_RELEASE_KEYS='` + keys.replace(/'/g, "'\\''") + `'`,
    `OMO_RELEASE_V_SIGN=${JSON.stringify(vSign)}`,
    functionSource("version_lt"),
    functionSource("verify_release_signature"),
  ].join("\n")

const seedOf = (hex: string): Uint8Array => new Uint8Array(Buffer.from(hex, "hex"))
const spkiOf = (seed: Uint8Array): string => {
  const der = Buffer.concat([Buffer.from("302e020100300506032b657004220420", "hex"), Buffer.from(seed)])
  return createPublicKey(createPrivateKey({ key: der, format: "der", type: "pkcs8" })).export({ format: "der", type: "spki" }).toString("base64")
}

const runHarness = (work: string, explicit: string, version: string): { code: number; stderr: string } => {
  const pinned = vectors.pinned_public_keys_hex
    .map((hex, i) => {
      const seedHex = i === 0 ? vectors.primary_seed_hex : vectors.backup_seed_hex
      const keyid = Buffer.from(minisignKeyidOf(publicKeyOfSeed(seedOf(seedHex)))).toString("hex")
      return `${keyid}|${spkiOf(seedOf(seedHex))}`
    })
    .join("\n")
  const harnessPath = join(work, "harness.sh")
  writeFileSync(harnessPath, `${PRELUDE(pinned, "9.9.5")}\nverify_release_signature "${work}" "${version}" "${explicit}"\n`)
  const result = spawnSync("bash", [harnessPath], { encoding: "utf8" })
  return { code: result.status ?? -1, stderr: result.stderr }
}

const workDir = (sums: Uint8Array, sig?: Uint8Array): string => {
  const root = mkdtempSync(join(tmpdir(), "omo-sh-sig-"))
  roots.push(root)
  writeFileSync(join(root, "SHA256SUMS"), sums)
  if (sig !== undefined) writeFileSync(join(root, "SHA256SUMS.sig"), sig)
  return root
}

const goodSums = new TextEncoder().encode(vectors.message_utf8)
const goodSig = new TextEncoder().encode(vectors.cases[0].sig_file)

describe("install.sh verify_release_signature (#14916)", () => {
  test("a valid ED signature under a pinned key passes and reports the key", () => {
    const r = runHarness(workDir(goodSums, goodSig), "0", "9.9.10")
    expect(r.code).toBe(0)
    expect(r.stderr).toContain("release signature verified")
  })

  test("a missing signature at or after V_sign refuses on the latest path", () => {
    const r = runHarness(workDir(goodSums), "0", "9.9.10")
    expect(r.code).toBe(1)
    expect(r.stderr).toContain("signature missing")
  })

  test("a missing signature before V_sign continues for an explicitly pinned version", () => {
    const r = runHarness(workDir(goodSums), "1", "9.9.1")
    expect(r.code).toBe(0)
    expect(r.stderr).toContain("predates signed releases")
  })

  test("a tampered checksum list refuses as an invalid signature", () => {
    const tampered = new Uint8Array([...goodSums.slice(0, 100), goodSums[100]! ^ 1, ...goodSums.slice(101)])
    const r = runHarness(workDir(tampered, goodSig), "0", "9.9.10")
    expect(r.code).toBe(1)
    expect(r.stderr).toContain("signature invalid")
  })

  test("the shared vector file produces the same verdicts as the TS verifier (cross-surface agreement)", () => {
    for (const c of vectors.cases) {
      const message = "message_override_utf8" in c && c.message_override_utf8 !== undefined ? new TextEncoder().encode(c.message_override_utf8) : goodSums
      const r = runHarness(workDir(message, new TextEncoder().encode(c.sig_file)), "0", "9.9.10")
      const verdict = r.code === 0 ? "ok" : `refuse:${c.expect.replace("refuse:", "")}`
      expect([c.name, verdict]).toEqual([c.name, c.expect])
      if (r.code !== 0 && c.expect === "ok") throw new Error(`${c.name}: shell refused a valid vector: ${r.stderr}`)
      if (r.code === 0 && c.expect !== "ok") throw new Error(`${c.name}: shell accepted a refused vector`)
    }
  })
})
