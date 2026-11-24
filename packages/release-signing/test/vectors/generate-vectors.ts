#!/usr/bin/env bun
// #14916 shared signature vectors: the ONE file every surface's verifier runs (TS here; install.sh and install.ps1
// legs consume the same JSON in CI), so all surfaces must reach identical verdicts — the cross-surface agreement
// the keyring delta read requires. Fixture keys are throwaway; the release key set is never in here. Deterministic:
// fixed seeds, no clock, no network. Re-run: bun packages/release-signing/test/vectors/generate-vectors.ts
import { createHash, createPrivateKey, createPublicKey, sign as edSign } from "node:crypto"
import { writeFileSync } from "node:fs"
import { join } from "node:path"

const PKCS8 = Buffer.from("302e020100300506032b657004220420", "hex")
const b64 = (bytes: Uint8Array): string => Buffer.from(bytes).toString("base64")
const blake2b512 = (message: Uint8Array): Buffer => createHash("blake2b512").update(message).digest()
const edSignWith = (seed: Buffer, message: Uint8Array): Buffer =>
  edSign(null, Buffer.from(message), createPrivateKey({ key: Buffer.concat([PKCS8, seed]), format: "der", type: "pkcs8" }))
const pkOf = (seed: Buffer): Buffer => {
  const der = createPublicKey({ key: Buffer.concat([PKCS8, seed]), format: "der", type: "pkcs8" }).export({ format: "der", type: "spki" })
  return Buffer.from(der.subarray(der.length - 32))
}
const keyidOf = (pk: Buffer): Buffer => blake2b512(pk).subarray(0, 8)

const primarySeed = Buffer.alloc(32, 1)
const backupSeed = Buffer.alloc(32, 2)
const strangerSeed = Buffer.alloc(32, 3)
const message = Buffer.from("# omo-release-v1 version=9.9.9 channel=stable\n" + "a".repeat(64) + "  omo-linux-x64\n", "utf8")
const TRUSTED = "omo release 9.9.9 stable vectors"

const sigFileOf = (seed: Buffer, algo: "ED" | "Ed", messageForSig: Uint8Array): string => {
  const pk = pkOf(seed)
  const globalSig = algo === "ED" ? edSignWith(seed, blake2b512(messageForSig)) : edSignWith(seed, messageForSig)
  const commentSig = edSignWith(seed, Buffer.concat([globalSig, Buffer.from(TRUSTED, "utf8")]))
  const sigLine = b64(Buffer.concat([Buffer.from(algo, "latin1"), keyidOf(pk), globalSig]))
  return `untrusted comment: minisign signature\n${sigLine}\ntrusted comment: ${TRUSTED}\n${b64(commentSig)}\n`
}

const validPrimary = sigFileOf(primarySeed, "ED", message)
const globalLineOf = (sigFile: string): Buffer => Buffer.from(sigFile.split("\n")[1] ?? "", "base64")
const withGlobalBlock = (sigFile: string, block: Buffer, commentSig?: Buffer): string => {
  const lines = sigFile.split("\n")
  const rebuilt = [lines[0], b64(block), lines[2], b64(commentSig ?? Buffer.from(lines[3] ?? "", "base64"))]
  return rebuilt.join("\n") + "\n"
}
const L = 2n ** 252n + 27742317777372353535851937790883648493n
const leInt = (bytes: Buffer): bigint => bytes.reduceRight((acc, byte) => (acc << 8n) | BigInt(byte), 0n)
const leBytes = (value: bigint): Buffer => { const out = Buffer.alloc(32); let v = value; for (let i = 0; i < 32; i += 1) { out[i] = Number(v & 0xffn); v >>= 8n } return out }

const primaryBlock = globalLineOf(validPrimary)
const nonCanonicalSBlock = Buffer.concat([primaryBlock.subarray(0, 42), leBytes(leInt(primaryBlock.subarray(42)) + L)])
const smallOrderAKey = Buffer.concat([Buffer.from("0100000000000000000000000000000000000000000000000000000000000000", "hex")])
const strangerBlock = globalLineOf(sigFileOf(strangerSeed, "ED", message))

writeFileSync(
  join(import.meta.dir, "shared-vectors.json"),
  JSON.stringify(
    {
      message_utf8: message.toString("utf8"),
      primary_seed_hex: primarySeed.toString("hex"),
      backup_seed_hex: backupSeed.toString("hex"),
      pinned_public_keys_hex: [pkOf(primarySeed).toString("hex"), pkOf(backupSeed).toString("hex")],
      cases: [
        { name: "valid_primary_ed", expect: "ok", sig_file: validPrimary },
        { name: "valid_backup_ed", expect: "ok", sig_file: sigFileOf(backupSeed, "ED", message) },
        { name: "wrong_key_signature", expect: "refuse:signature", sig_file: sigFileOf(strangerSeed, "ED", message) },
        { name: "raw_ed_algorithm_refused", expect: "refuse:algorithm", sig_file: sigFileOf(primarySeed, "Ed", message) },
        {
          name: "tampered_message_bit",
          expect: "refuse:signature",
          sig_file: validPrimary,
          message_override_utf8: message.toString("utf8").replace("omo-linux-x64", "omo-linux-x65"),
        },
        { name: "tampered_signature_byte", expect: "refuse:signature", sig_file: withGlobalBlock(validPrimary, Buffer.concat([primaryBlock.subarray(0, 43), Buffer.from([primaryBlock[43]! ^ 1]), primaryBlock.subarray(44)])) },
        { name: "noncanonical_s_refused", expect: "refuse:malformed", sig_file: withGlobalBlock(validPrimary, nonCanonicalSBlock) },
        { name: "extra_line_refused", expect: "refuse:malformed", sig_file: validPrimary.replace(/\n$/, "\nextra\n") },
        { name: "short_block_refused", expect: "refuse:wrong_length", sig_file: validPrimary.replace(validPrimary.split("\n")[1] ?? "", b64(primaryBlock.subarray(0, 73))) },
        { name: "stranger_keyid_only_refused", expect: "refuse:signature", sig_file: withGlobalBlock(validPrimary, Buffer.concat([strangerBlock.subarray(0, 10), primaryBlock.subarray(10)])) },
      ],
      verifier_key_sets: {
        normal: [pkOf(primarySeed).toString("hex"), pkOf(backupSeed).toString("hex")],
        small_order_a: [smallOrderAKey.toString("hex")],
      },
    },
    null,
    2,
  ) + "\n",
)
console.log("vectors written:", join(import.meta.dir, "shared-vectors.json"))
