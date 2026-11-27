// Full Unicode case folding from the vendored CaseFolding.txt (Unicode 16.0.0), so the
// result is identical on every runtime and never depends on the host's ICU. Only the C
// (common) and F (full) mappings apply; T (Turkic) mappings are locale variants and are
// never used, and S (simple) lines are shadowed by their F lines.

import { dirname, isAbsolute, resolve } from "node:path"
import { fileURLToPath } from "node:url"

import { readFileSync } from "../../fs/resilient"

import dataPath from "./CaseFolding.txt" with { type: "file" }

let cached: ReadonlyMap<number, readonly number[]> | undefined

function loadTable(): ReadonlyMap<number, readonly number[]> {
  if (cached !== undefined) return cached
  const table = new Map<number, readonly number[]>()
  // The file loader names the asset relative to a plain bundle; anchor it to this module, never the cwd.
  const file = isAbsolute(dataPath) ? dataPath : resolve(dirname(fileURLToPath(import.meta.url)), dataPath)
  const text = readFileSync(file, "utf8")
  for (const line of text.split("\n")) {
    if (line === "" || line.startsWith("#")) continue
    const fields = line.split(";")
    const status = fields[1]?.trim()
    if (status !== "C" && status !== "F") continue
    const codeText = fields[0]?.trim() ?? ""
    const mappingText = fields[2]?.trim() ?? ""
    if (codeText === "" || mappingText === "") continue
    const code = Number.parseInt(codeText, 16)
    const mapping = mappingText.split(/\s+/).map((hex: string) => Number.parseInt(hex, 16))
    // The file lists the C line before the F line for one code point; keep the full fold.
    if (status === "F" || !table.has(code)) table.set(code, mapping)
  }
  cached = table
  return table
}

/** Map each code point through the full fold table; unmapped code points pass through. */
export function caseFold(text: string): string {
  const table = loadTable()
  let out = ""
  for (const char of text) {
    const code = char.codePointAt(0)
    const mapped = code === undefined ? undefined : table.get(code)
    out += mapped === undefined ? char : String.fromCodePoint(...mapped)
  }
  return out
}
