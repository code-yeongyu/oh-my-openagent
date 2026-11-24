#!/usr/bin/env bun
// #14916 release signer: signs one release's SHA256SUMS into a stock-minisign-compatible SHA256SUMS.sig.
// Runs ONLY inside the release job's signing step. The seed arrives as OMO_RELEASE_SIGN_KEY_SEED (base64) in the
// protected environment and never appears in a log, an artifact or the repo: nothing here prints it.
// The signer refuses to run when the committed pinned key set is active and the seed's key is not in it.
import { readFileSync, writeFileSync } from "node:fs"
import { parseArgs } from "node:util"
import { signMinisignEd, publicKeyOfSeed } from "@oh-my-opencode/release-signing/sign"
import { RELEASE_SIGNING_ACTIVE, releaseSigningKeyBytes } from "@oh-my-opencode/release-signing/keys"

const { values } = parseArgs({
  args: Bun.argv.slice(2),
  options: {
    sums: { type: "string" },
    "out-dir": { type: "string" },
    version: { type: "string" },
    channel: { type: "string" },
    tag: { type: "string" },
  },
  strict: true,
})

const fail = (message: string): never => {
  console.error(`release-sign: ${message}`)
  process.exit(1)
}

const sumsPath = values.sums ?? fail("--sums, --version, --channel and --tag are required")
const seedB64 = process.env.OMO_RELEASE_SIGN_KEY_SEED ?? ""
// H1 sequencing: signing starts BEFORE the verifier ships, so the workflow calls this step from the first release
// after merge. Until the LEAD lands the pinned key set, the step is a no-op so the publish pipeline keeps flowing.
if (!RELEASE_SIGNING_ACTIVE && (seedB64 === undefined || seedB64.length === 0)) {
  console.log("release-sign: pinned key set inactive (no committed keys); skipping signing")
  process.exit(0)
}
if (seedB64 === undefined || seedB64.length === 0) fail("OMO_RELEASE_SIGN_KEY_SEED is empty; the signing environment did not provide the key")
const seed = Buffer.from(seedB64, "base64")
if (seed.length !== 32) fail("OMO_RELEASE_SIGN_KEY_SEED must decode to exactly 32 bytes")

const pinned = RELEASE_SIGNING_ACTIVE ? releaseSigningKeyBytes() : []
const pk = publicKeyOfSeed(seed)
const message = readFileSync(sumsPath)
const trustedComment = `omo release ${values.version} ${values.channel} ${values.tag}`
const sig = signMinisignEd(seed, message, trustedComment, pinned)
const out = `${values["out-dir"] ?? "."}/SHA256SUMS.sig`
writeFileSync(out, sig)
// The public half is safe to echo: it is the same value the repo pins, printed so the release log shows WHICH key signed.
console.log(`release-sign: wrote ${out} (${sig.length} bytes) with public key ${Buffer.from(pk).toString("hex")}`)
