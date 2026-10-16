#!/usr/bin/env node
// Validate transport AND decoded lineage; --normalize only changes UTF-16LE transport.
import { execFileSync } from "node:child_process"
import { readFileSync, writeFileSync } from "node:fs"
import { dirname, resolve, relative, isAbsolute } from "node:path"
import { fileURLToPath } from "node:url"

const here = dirname(fileURLToPath(import.meta.url))
const repo = resolve(here, "..")
const manifest = JSON.parse(readFileSync(resolve(here, "manifest.json"), "utf8"))
const git = (args, input) => execFileSync("git", args, {
  cwd: repo, input, encoding: "utf8", timeout: 20_000, maxBuffer: 8 * 1024 * 1024,
})
const patchId = (text) => git(["patch-id", "--stable"], text).trim().split(/\s+/)[0]
const ids = new Set()
for (const fix of manifest.fixes) {
  if (ids.has(fix.id)) throw new Error(`duplicate fix ${fix.id}`)
  ids.add(fix.id)
  const path = resolve(here, fix.patch)
  const rel = relative(here, path)
  if (rel.startsWith("..") || isAbsolute(rel)) throw new Error(`escaping patch ${fix.id}`)
  const bytes = readFileSync(path)
  const utf16 = bytes[0] === 0xff && bytes[1] === 0xfe
  const decoded = bytes.toString(utf16 ? "utf16le" : "utf8").replace(/^\uFEFF/, "")
  const expected = patchId(git(["show", "--format=", "--binary", fix.commit]))
  const actual = patchId(decoded)
  if (!actual || actual !== expected) throw new Error(`lineage mismatch ${fix.id}: ${actual} != ${expected}`)
  if (utf16 && process.argv.includes("--normalize")) {
    writeFileSync(path, decoded, "utf8")
    if (patchId(readFileSync(path, "utf8")) !== expected) throw new Error(`normalization changed ${fix.id}`)
  } else if (utf16) throw new Error(`UTF-16LE transport ${fix.id}; run --normalize`)
  console.log(`PASS ${fix.id} ${actual}${utf16 ? " normalized UTF-16LE -> UTF-8" : ""}`)
}
console.log(`PASS ${ids.size}/${manifest.fixes.length} paths, unique entries and stable patch IDs`)
