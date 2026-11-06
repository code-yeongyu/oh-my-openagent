#!/usr/bin/env bun
import { execFileSync } from "node:child_process"
import { readFileSync } from "node:fs"
import { reportOnlyEntryMatches } from "../test-temp-leak-match.ts"

// How test-temp-leak-report-only.json was built, and how a package PR checks what it can remove (#9766).
//
// The list is the union of two sources:
// - The temp names test creators in the source derive (this script): mkdtemp literals, template literals
//   cut at the first `${`, concatenated names, and fixed names joined under a temp dir (exact, ending in "$").
// - The leftovers the guard reported in measured full runs (the "Known temp leaks" lines), which cover
//   names a helper builds at runtime. Those cannot be derived from source, so this script does not
//   rebuild the list byte for byte; it shows which listed entries still have a creator in the source.
//
// Usage: bun script/derive-temp-leak-report-only.ts [owner]
//   Prints, per owner, the derived prefixes and the listed entries no source creator matches
//   (measured-only or stale: a package PR confirms them by a run before removing them).

// Deliberately broad (any identifier containing temp/tmp, so `attempt(` too): an over-match only hides a stale
// entry from the "no source creator" report, it never makes a real creator disappear.
const TEMP = String.raw`(?:(?:os|path)\.)?(?:tmpdir\(\)|\w*(?:[Tt]emp|[Tt]mp)\w*)`
const JOIN_UNDER_TEMP = String.raw`(?:path\.)?(?:join|resolve)\(\s*` + TEMP + String.raw`\s*,\s*`

const CREATORS: ReadonlyArray<readonly [RegExp, "prefix" | "exact"]> = [
  [new RegExp(String.raw`mkdtemp(?:Sync)?\(\s*` + JOIN_UNDER_TEMP + String.raw`(["'\`])([^"'\`$]+)\1`, "g"), "prefix"],
  [new RegExp(String.raw`mkdtemp(?:Sync)?\(\s*\`\$\{\s*` + TEMP + String.raw`\s*\}[\\/]([^\`$]+)\``, "g"), "prefix"],
  [/\b\w*(?:[Tt]emp|[Tt]mp)\w*\(\s*(["'`])([a-zA-Z0-9._@-]+-)\1/g, "prefix"],
  [new RegExp(JOIN_UNDER_TEMP + String.raw`\`([^\`$]+)\$\{`, "g"), "prefix"],
  [new RegExp(JOIN_UNDER_TEMP + String.raw`(["'])([^"']+)\1\s*\+`, "g"), "prefix"],
  [new RegExp(String.raw`\`\$\{\s*` + TEMP + String.raw`\s*\}[\\/]([^\`$/\\]+)\$\{`, "g"), "prefix"],
  [new RegExp(JOIN_UNDER_TEMP + String.raw`(["'])([^"'/\\]+)\1\s*[,)]`, "g"), "exact"],
]

/** The list entries one source file's temp creators derive: prefixes, and exact names ending in "$". */
export function deriveTempEntries(source: string): string[] {
  const entries = new Set<string>()
  for (const [pattern, kind] of CREATORS) {
    for (const match of source.matchAll(pattern)) {
      const name = match[match.length - 1]
      if (!name || name.length < 3) continue
      entries.add(kind === "exact" && !name.endsWith("-") ? `${name}$` : name)
    }
  }
  return [...entries].sort()
}

/** Whether a listed entry has a creator: equal to a derived entry, covering it, or a call-site name under a derived prefix. */
export function hasSourceCreator(entry: string, creators: readonly string[]): boolean {
  return creators.some(
    (creator) =>
      creator === entry
      || reportOnlyEntryMatches(entry, creator.replace(/\$$/, ""))
      || (!creator.endsWith("$") && entry.replace(/\$$/, "").startsWith(creator)),
  )
}

export function ownerOf(file: string): string {
  const [first = "", second] = file.split("/")
  return first === "packages" && second ? second : first
}

function trackedSources(): string[] {
  const out = execFileSync("git", ["ls-files", "*.ts", "*.mts", "*.mjs", "*.js", "*.tsx"], { encoding: "utf8" })
  return out
    .split("\n")
    .filter((file) => file && !/(^|\/)(dist|install-dist|node_modules|vendor)\/|plugin\/extensions\/|\.generated\.|\/upstreams\/|^script\/derive-temp-leak-report-only\.test\.ts$/.test(file))
}

function main(): void {
  const onlyOwner = process.argv[2]
  const derived = new Map<string, Set<string>>()
  for (const file of trackedSources()) {
    const owner = ownerOf(file)
    if (onlyOwner && owner !== onlyOwner) continue
    const source = readFileSync(file, "utf8")
    if (!/tmpdir|[Tt]emp|[Tt]mp/.test(source)) continue
    for (const entry of deriveTempEntries(source)) derived.set(owner, (derived.get(owner) ?? new Set()).add(entry))
  }
  const listed: Record<string, string[]> = JSON.parse(readFileSync("test-temp-leak-report-only.json", "utf8"))
  for (const owner of Object.keys(listed).sort()) {
    if (onlyOwner && owner !== onlyOwner) continue
    const creators = [...(derived.get(owner) ?? [])]
    const entries = listed[owner] ?? []
    const unmatched = entries.filter((entry) => !hasSourceCreator(entry, creators))
    console.log(`${owner}: ${entries.length} listed, ${creators.length} derived from source, ${unmatched.length} with no source creator`)
    if (unmatched.length > 0) console.log(`  no source creator: ${unmatched.join(" ")}`)
  }
}

if (import.meta.main) main()
