import { posix, win32 } from "node:path"
import { expect, test } from "bun:test"

import { isSyncItemKey } from "./key"

// Property (#12147 R11): any key the grammar accepts stays inside the memory root on POSIX and on
// Windows path semantics, never names repository metadata under any folding git applies, and is
// already NFC. The oracle is node's own path resolution, not the grammar's code.

const TOKENS = ["a", "Z", "é", "e\u0301", "김", ".", "..", "/", "//", "\\", ":", "~", "$", "git", ".git", "GIT", ".GiT", "~1", "~12", " ", ".", "\u0000", "\u200c", "\ufeff", "con", "NUL", "?", "*", "-", "_", "md", "C:", "git.exe"]
const CASES = 20_000

function prng(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296
  }
}

const inside = (root: string, target: string, sep: string): boolean => target.startsWith(root + sep)

const namesRepositoryMetadata = (segment: string): boolean => {
  const folded = segment.toLowerCase().replace(/[. ]+$/, "")
  return folded === ".git" || /^git~\d+$/.test(folded)
}

test("every accepted key resolves inside the root, never names repository metadata, and is NFC", () => {
  const random = prng(12147)
  let accepted = 0
  for (let n = 0; n < CASES; n += 1) {
    const length = 1 + Math.floor(random() * 8)
    const key = Array.from({ length }, () => TOKENS[Math.floor(random() * TOKENS.length)] ?? "a").join("")
    if (isSyncItemKey(key) !== null) continue
    accepted += 1
    expect([key, inside("/root", posix.resolve("/root", key), "/")]).toEqual([key, true])
    expect([key, inside("C:\\root", win32.resolve("C:\\root", key), "\\")]).toEqual([key, true])
    expect([key, key.split("/").some(namesRepositoryMetadata)]).toEqual([key, false])
    expect([key, key.normalize("NFC")]).toEqual([key, key])
  }
  expect(accepted).toBeGreaterThan(CASES / 20)
})
