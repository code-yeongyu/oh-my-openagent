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

// The key grammar every sync surface enforces before a key reaches the file system or git
// (#12147). A key is the item's working-tree path as sent, never folded: case and script are
// kept. It refuses anything that could leave the memory root, name repository metadata under
// any spelling git or a file system folds to `.git` (case, trailing dots and spaces, 8.3 short
// names; ignorable code points are refused as format characters), or that no Windows peer can
// hold. Refused keys are dropped item by item, so the grammar may only tighten across releases.

export type SyncKeyProblem =
  | "empty"
  | "too-long"
  | "backslash"
  | "forbidden-code-point"
  | "not-nfc"
  | "absolute"
  | "drive-prefix"
  | "bad-segment"
  | "repository-metadata"
  | "segment-too-long"
  | "reserved-character"
  | "trailing-dot-or-space"
  | "reserved-device-name"
  | "git-executable"

const MAX_KEY_BYTES = 4096
const MAX_SEGMENT_BYTES = 255
const FORBIDDEN_CODE_POINT = /[\p{Cc}\p{Cf}\p{Cn}\p{Co}\p{Cs}\uFEFF]/u
const RESERVED_CHARACTER = /[<>:"|?*]/
// Win32 also reserves the superscript-digit ports and the console input/output devices.
const RESERVED_DEVICE = /^(?:con|prn|aux|nul|com[1-9\u00b9\u00b2\u00b3]|lpt[1-9\u00b9\u00b2\u00b3]|conin\$|conout\$)$/i
// Defence in depth until git is resolved by absolute path at every exec site (#12146).
const GIT_EXECUTABLE = /^git\.(?:com|exe|bat|cmd|vbs|vbe|js|jse|wsf|wsh|msc|ps1)$/i
const GIT_SHORT_NAME = /^git~\d+$/

const byteLength = (text: string): number => Buffer.byteLength(text, "utf8")

function segmentProblem(segment: string): SyncKeyProblem | null {
  if (segment === "" || segment === "." || segment === "..") return "bad-segment"
  const folded = caseFold(segment).replace(/[. ]+$/, "")
  if (folded === ".git" || GIT_SHORT_NAME.test(folded)) return "repository-metadata"
  if (byteLength(segment) > MAX_SEGMENT_BYTES) return "segment-too-long"
  if (RESERVED_CHARACTER.test(segment)) return "reserved-character"
  if (segment.endsWith(".") || segment.endsWith(" ")) return "trailing-dot-or-space"
  if (RESERVED_DEVICE.test(segment.split(".")[0] ?? "")) return "reserved-device-name"
  return null
}

/** Why `key` can never be a synced item, or null when it can. */
export function isSyncItemKey(key: string): SyncKeyProblem | null {
  if (key === "") return "empty"
  if (byteLength(key) > MAX_KEY_BYTES) return "too-long"
  if (key.includes("\\")) return "backslash"
  if (FORBIDDEN_CODE_POINT.test(key)) return "forbidden-code-point"
  if (key.normalize("NFC") !== key) return "not-nfc"
  if (key.startsWith("/")) return "absolute"
  if (DRIVE_RE.test(key)) return "drive-prefix"
  const segments = key.split("/")
  for (const segment of segments) {
    const problem = segmentProblem(segment)
    if (problem !== null) return problem
  }
  if (segments.length === 1 && GIT_EXECUTABLE.test(key)) return "git-executable"
  return null
}
