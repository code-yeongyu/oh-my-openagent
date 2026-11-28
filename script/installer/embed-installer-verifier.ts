#!/usr/bin/env bun
// #14916: embeds MinisignEd25519.cs into install.ps1 as a gzip+base64 HERE-STRING payload. The installer often
// runs via `irm .../install.ps1 | iex`, where $PSCommandPath does not exist: the payload must live in the script
// text itself. install.ps1 decompresses with .NET BCL and Add-Types the source at run time. The drift test pins
// this payload against the .cs file.
import { readFileSync, writeFileSync } from "node:fs"
import { gzipSync } from "node:zlib"
import { createHash } from "node:crypto"

const CS_PATH = "packages/get-worker/scripts/MinisignEd25519.cs"
const PS1_PATH = "packages/get-worker/scripts/install.ps1"
const BEGIN = "# >>> omo release-signature verifier payload (#14916) >>>"
const END = "# <<< omo release-signature verifier payload (#14916) <<<"

const cs = readFileSync(CS_PATH)
const payload = gzipSync(cs, { level: 9 }).toString("base64")
const lines: string[] = []
for (let i = 0; i < payload.length; i += 96) lines.push(payload.slice(i, i + 96))
const block = [BEGIN, "$OmoVerifierPayload = @'", ...lines, "'@", END].join("\n")

const ps1 = readFileSync(PS1_PATH, "utf8")
const previous = ps1.includes(BEGIN) ? ps1.replace(new RegExp(`${BEGIN}[\\s\\S]*?${END}\n?`), "") : ps1
writeFileSync(PS1_PATH, `${block}\n${previous}`)
console.log(`embed-installer-verifier: ${CS_PATH} -> ${PS1_PATH} (${cs.length} bytes -> ${lines.length} payload lines, sha256 ${createHash("sha256").update(cs).digest("hex").slice(0, 16)})`)
