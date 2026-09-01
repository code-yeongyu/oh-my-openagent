import { describe, expect, it } from "bun:test"
import { createHash } from "node:crypto"
import { tmpdir } from "node:os"
import { isAbsolute, join, relative } from "node:path"
import { AGENTS_DIRNAME, MEMORY_ROOT_ENV_VAR } from "./layout"
import { MAX_SLUG_LENGTH, resolveMemoryIdentity } from "./resolve"

const SAFE_ID_PATTERN = /^[a-z0-9][a-z0-9-]*$/
const MAX_ID_LENGTH = MAX_SLUG_LENGTH + 1 + 8
const OVERRIDE_ROOT = join(tmpdir(), "qa-memory-home")
const env = { [MEMORY_ROOT_ENV_VAR]: OVERRIDE_ROOT }

function expectedHash(input: string): string {
  return createHash("sha256").update(input, "utf8").digest("hex").slice(0, 8)
}

function expectConfined(memoryRoot: string, candidate: string): void {
  const rel = relative(memoryRoot, candidate)
  expect(rel.startsWith("..")).toBe(false)
  expect(isAbsolute(rel)).toBe(false)
}

describe("resolveMemoryIdentity sanitization confinement", () => {
  const nastyInputs = [
    "../evil",
    "../../etc",
    "..\\..\\windows",
    "/etc/passwd",
    "a/b/c",
    "a\0b",
    "\0",
    "..",
    ".",
    "...",
    "CON",
    "e\u202Evil",
    "ＥＶＩＬ",
    "漢字",
    "x".repeat(300),
    " -x- ",
    "élan",
    "~/escape",
    "$HOME/evil",
  ]

  it("#given hostile explicit ids #when resolved #then every id is a safe slug and every path stays confined", () => {
    // given the nasty input table above
    for (const input of nastyInputs) {
      // when
      const identity = resolveMemoryIdentity(input, "/repo/alpha", env)
      // then
      expect(identity.id).toMatch(SAFE_ID_PATTERN)
      expect(identity.id.length).toBeLessThanOrEqual(MAX_ID_LENGTH)
      expect(identity.id).not.toContain("..")
      expect(identity.id).not.toContain("/")
      expect(identity.id).not.toContain("\\")
      expect(identity.id).not.toContain("\0")
      expect(identity.paths.root).toBe(join(OVERRIDE_ROOT, AGENTS_DIRNAME, identity.id))
      for (const candidate of Object.values(identity.paths)) {
        expectConfined(OVERRIDE_ROOT, candidate)
      }
    }
  })

  it("#given '../evil' #when resolved #then it becomes a benign slug and never escapes the root", () => {
    // given / when
    const identity = resolveMemoryIdentity("../evil", "/repo/alpha", env)
    // then
    expect(identity.safeSlug).toBe("evil")
    expect(identity.id).toBe(`evil-${expectedHash("../evil")}`)
    expect(identity.paths.root).toBe(join(OVERRIDE_ROOT, AGENTS_DIRNAME, identity.id))
  })

  it("#given inputs that sanitize to the same slug #when resolved #then hash suffixes keep them distinct", () => {
    // given / when
    const hostile = resolveMemoryIdentity("../evil", "/repo/alpha", env)
    const honest = resolveMemoryIdentity("evil", "/repo/alpha", env)
    // then
    expect(hostile.safeSlug).toBe("evil")
    expect(honest.safeSlug).toBe("evil")
    expect(hostile.id).not.toBe(honest.id)
    expect(hostile.paths.root).not.toBe(honest.paths.root)
  })
})
