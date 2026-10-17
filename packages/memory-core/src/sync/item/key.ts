// Item keys (sync-design §1): the sync identity of a file is its repo-relative path with
// "/" separators, Unicode NFC, then the vendored full case fold, so a case-insensitive
// file system can never split one item into two. `..` segments, absolute paths, NUL and
// the empty path are never items. Spellings that would give one file several identities
// are rejected rather than canonicalized (review r1 #4): empty or "." segments, a
// trailing slash, backslashes and Windows drive prefixes. The folded key is NFC'd again
// so the key is always stored in NFC (the fold itself can emit combining marks).

import { caseFold } from "./casefold"

// Any drive prefix, including the drive-relative `c:x` (no separator after the colon).
const DRIVE_RE = /^[A-Za-z]:/

export function normalizeItemKey(path: string): string | null {
  if (path === "" || path.includes("\0") || path.includes("\\")) return null
  if (path.startsWith("/") || DRIVE_RE.test(path)) return null
  const normalized = path.normalize("NFC")
  for (const segment of normalized.split("/")) {
    if (segment === ".." || segment === "." || segment === "") return null
  }
  return caseFold(normalized).normalize("NFC")
}
