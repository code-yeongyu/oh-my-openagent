import { describe, expect, test } from "bun:test"

import { isSyncItemKey, type SyncKeyProblem } from "./key"

const MAX_KEY = [...Array.from({ length: 16 }, () => "s".repeat(254)), "t".repeat(16)].join("/")

const REFUSED: readonly (readonly [string, SyncKeyProblem])[] = [
  ["", "empty"],
  [`${MAX_KEY}u`, "too-long"],
  ["a\\b.md", "backslash"],
  ["\\\\srv\\share\\x.md", "backslash"],
  ["bad\u0000.md", "forbidden-code-point"],
  ["tab\t.md", "forbidden-code-point"],
  ["x\u200c.md", "forbidden-code-point"],
  ["\ufeffx.md", "forbidden-code-point"],
  ["x\ud800.md", "forbidden-code-point"],
  ["x\ue000.md", "forbidden-code-point"],
  ["x\u0378.md", "forbidden-code-point"],
  [".g\u200cit/config", "forbidden-code-point"],
  ["cafe\u0301.md", "not-nfc"],
  ["/abs.md", "absolute"],
  ["//srv/share/x.md", "absolute"],
  ["C:x.md", "drive-prefix"],
  ["c:/x.md", "drive-prefix"],
  ["..", "bad-segment"],
  ["../x.md", "bad-segment"],
  ["a/../../x.md", "bad-segment"],
  ["./x.md", "bad-segment"],
  ["a//b.md", "bad-segment"],
  ["a/", "bad-segment"],
  [".git", "repository-metadata"],
  [".git/config", "repository-metadata"],
  ["sub/.GIT/x", "repository-metadata"],
  [".Git./config", "repository-metadata"],
  [".git /config", "repository-metadata"],
  ["GIT~1/config", "repository-metadata"],
  ["git~42", "repository-metadata"],
  [`${"a".repeat(256)}/x.md`, "segment-too-long"],
  ["é".repeat(128), "segment-too-long"],
  ["q?.md", "reserved-character"],
  ["a<b.md", "reserved-character"],
  ["a>b.md", "reserved-character"],
  ['a"b.md', "reserved-character"],
  ["a|b.md", "reserved-character"],
  ["a*b.md", "reserved-character"],
  ["a:b.md", "drive-prefix"],
  ["ab:c.md", "reserved-character"],
  ["x.", "trailing-dot-or-space"],
  ["x /y.md", "trailing-dot-or-space"],
  ["con", "reserved-device-name"],
  ["CON.md", "reserved-device-name"],
  ["dir/nul.txt", "reserved-device-name"],
  ["com1.tar.gz", "reserved-device-name"],
  ["LPT9/x.md", "reserved-device-name"],
  ["Aux", "reserved-device-name"],
  ["prn.md", "reserved-device-name"],
  ["COM\u00b9", "reserved-device-name"],
  ["com\u00b2.md", "reserved-device-name"],
  ["dir/LPT\u00b3.txt", "reserved-device-name"],
  ["lpt\u00b9", "reserved-device-name"],
  ["CONIN$", "reserved-device-name"],
  ["conout$.log", "reserved-device-name"],
  ["dir/Conin$.md", "reserved-device-name"],
  ["git.exe", "git-executable"],
  ["GIT.Cmd", "git-executable"],
  ["git.ps1", "git-executable"],
]

const ACCEPTED: readonly string[] = [
  "notes.md",
  "ARCHIVE.md",
  "people/김영규/card.md",
  "café.md",
  "skills/x/scripts/run.sh",
  "templates/setup.sh",
  "$notes.md",
  "$HOME/x.md",
  "~/x.md",
  "~",
  "a/git.exe",
  "gitx.md",
  ".gitignore",
  ".github/workflows/ci.yml",
  "git~x",
  "com10.md",
  "console.md",
  "lpt0.md",
  "com\u2074.md",
  "conin.md",
  "conin$x.md",
  "$conout.md",
  ".hidden",
  "a".repeat(255),
  MAX_KEY,
  "x.y.z",
]

describe("isSyncItemKey", () => {
  test("names the rule a refused key breaks", () => {
    for (const [key, problem] of REFUSED) expect([key, isSyncItemKey(key)]).toEqual([key, problem])
  })

  test("accepts any extension, depth, script and case the memory repos already track", () => {
    for (const key of ACCEPTED) expect([key, isSyncItemKey(key)]).toEqual([key, null])
  })
})
