import { describe, expect, test, beforeEach } from "bun:test"
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync, mkdirSync, chmodSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  createAlias,
  deleteAlias,
  listAliases,
  getAliasEntry,
  resolveSessionIdentifier,
  validateAliasName,
  validateSessionId,
} from "./manager"
import { getSessionAliasStoragePath } from "./storage"

function makeTempDir(): string {
  return mkdtempSync(join(tmpdir(), "session-alias-test-"))
}

describe("validateAliasName", () => {
  test("rejects empty", () => {
    expect(validateAliasName("").ok).toBe(false)
    expect(validateAliasName("   ").ok).toBe(false)
  })

  test("rejects ses_ prefix", () => {
    expect(validateAliasName("ses_abc").ok).toBe(false)
    expect(validateAliasName("SES_abc").ok).toBe(false)
  })

  test("rejects invalid chars", () => {
    expect(validateAliasName("hello world").ok).toBe(false)
    expect(validateAliasName("hello.world").ok).toBe(false)
    expect(validateAliasName("hello/world").ok).toBe(false)
    expect(validateAliasName("-hello").ok).toBe(false)
    expect(validateAliasName("hello-").ok).toBe(false)
  })

  test("rejects too long", () => {
    expect(validateAliasName("a".repeat(65)).ok).toBe(false)
  })

  test("accepts valid names", () => {
    expect(validateAliasName("hello").ok).toBe(true)
    expect(validateAliasName("hello-world").ok).toBe(true)
    expect(validateAliasName("hello_world").ok).toBe(true)
    expect(validateAliasName("my-bug-fix-123").ok).toBe(true)
    expect(validateAliasName("a").ok).toBe(true)
    expect(validateAliasName("a".repeat(64)).ok).toBe(true)
  })
})

describe("validateSessionId", () => {
  test("rejects empty / wrong prefix", () => {
    expect(validateSessionId("").ok).toBe(false)
    expect(validateSessionId("abc123").ok).toBe(false)
    expect(validateSessionId("session_abc").ok).toBe(false)
  })

  test("rejects whitespace/invalid chars", () => {
    expect(validateSessionId("ses_ abc").ok).toBe(false)
    expect(validateSessionId("ses_abc/def").ok).toBe(false)
  })

  test("accepts ses_ + alphanumeric", () => {
    expect(validateSessionId("ses_1e95074dcffeKzTEiIHrICIo4o").ok).toBe(true)
  })

  test("rejects too short", () => {
    expect(validateSessionId("ses_a").ok).toBe(false)
  })
})

describe("createAlias / listAliases / deleteAlias", () => {
  let dir: string

  beforeEach(() => {
    dir = makeTempDir()
  })

  test("creates and lists an alias", async () => {
    const result = await createAlias(
      { alias: "my-work", session_id: "ses_1e95074dcffeKzTEiIHrICIo4o" },
      { directory: dir },
    )
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.entry.alias).toBe("my-work")
    expect(result.entry.session_id).toBe("ses_1e95074dcffeKzTEiIHrICIo4o")
    expect(result.entry.created_at).toBeGreaterThan(0)

    const list = listAliases({ directory: dir })
    expect(list.length).toBe(1)
    expect(list[0].alias).toBe("my-work")
  })

  test("creates persists file at .opencode/session-aliases.json", async () => {
    await createAlias({ alias: "foo", session_id: "ses_abcdef123" }, { directory: dir })
    const file = getSessionAliasStoragePath({ directory: dir })
    expect(existsSync(file)).toBe(true)
    const parsed = JSON.parse(readFileSync(file, "utf-8"))
    expect(parsed.version).toBe(1)
    expect(parsed.aliases.foo.session_id).toBe("ses_abcdef123")
  })

  test("rejects duplicate alias without overwrite", async () => {
    await createAlias({ alias: "dup", session_id: "ses_aaa11111" }, { directory: dir })
    const second = await createAlias({ alias: "dup", session_id: "ses_bbb22222" }, { directory: dir })
    expect(second.ok).toBe(false)
    if (second.ok) return
    expect(second.code).toBe("exists")
  })

  test("overwrite=true replaces", async () => {
    await createAlias({ alias: "ow", session_id: "ses_aaa11111" }, { directory: dir })
    const second = await createAlias(
      { alias: "ow", session_id: "ses_bbb22222", overwrite: true },
      { directory: dir },
    )
    expect(second.ok).toBe(true)
    if (!second.ok) return
    expect(second.entry.session_id).toBe("ses_bbb22222")
    expect(second.replaced?.session_id).toBe("ses_aaa11111")
  })

  test("rejects invalid alias name", async () => {
    const result = await createAlias({ alias: "bad name", session_id: "ses_aaa11111" }, { directory: dir })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.code).toBe("validation")
  })

  test("rejects invalid session id", async () => {
    const result = await createAlias({ alias: "good", session_id: "not-a-session" }, { directory: dir })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.code).toBe("validation")
  })

  test("rejects ses_ prefix in alias name", async () => {
    const result = await createAlias({ alias: "ses_evil", session_id: "ses_aaa11111" }, { directory: dir })
    expect(result.ok).toBe(false)
  })

  test("rejects note that is too long", async () => {
    const result = await createAlias(
      { alias: "withnote", session_id: "ses_aaa11111", note: "x".repeat(257) },
      { directory: dir },
    )
    expect(result.ok).toBe(false)
  })

  test("delete removes alias", async () => {
    await createAlias({ alias: "tmp", session_id: "ses_aaa11111" }, { directory: dir })
    const del = await deleteAlias("tmp", { directory: dir })
    expect(del.ok).toBe(true)
    expect(listAliases({ directory: dir }).length).toBe(0)
  })

  test("delete returns not_found for missing alias", async () => {
    const del = await deleteAlias("nope", { directory: dir })
    expect(del.ok).toBe(false)
    if (del.ok) return
    expect(del.code).toBe("not_found")
  })

  test("listAliases returns sorted by alias name", async () => {
    await createAlias({ alias: "charlie", session_id: "ses_aaa11111" }, { directory: dir })
    await createAlias({ alias: "alpha", session_id: "ses_bbb22222" }, { directory: dir })
    await createAlias({ alias: "bravo", session_id: "ses_ccc33333" }, { directory: dir })
    const sorted = listAliases({ directory: dir }).map((e) => e.alias)
    expect(sorted).toEqual(["alpha", "bravo", "charlie"])
  })

  test("listAliases on empty dir returns []", () => {
    expect(listAliases({ directory: dir })).toEqual([])
  })

  test("listAliases recovers from corrupted file", () => {
    const file = getSessionAliasStoragePath({ directory: dir })
    mkdirSync(join(dir, ".opencode"), { recursive: true })
    writeFileSync(file, "{not valid json", "utf-8")
    expect(listAliases({ directory: dir })).toEqual([])
  })

  test("listAliases recovers from wrong-shape file", () => {
    const file = getSessionAliasStoragePath({ directory: dir })
    mkdirSync(join(dir, ".opencode"), { recursive: true })
    writeFileSync(file, JSON.stringify({ version: 99, aliases: { x: { bogus: 1 } } }), "utf-8")
    expect(listAliases({ directory: dir })).toEqual([])
  })

  test("trims whitespace on alias when reading", async () => {
    // Alias with surrounding whitespace should be normalized away.
    const result = await createAlias({ alias: "  trim-me  ", session_id: "ses_aaa11111" }, { directory: dir })
    expect(result.ok).toBe(true)
    const entry = getAliasEntry("trim-me", { directory: dir })
    expect(entry?.session_id).toBe("ses_aaa11111")
  })
})

describe("resolveSessionIdentifier", () => {
  let dir: string
  beforeEach(() => {
    dir = makeTempDir()
  })

  test("returns ses_ ids untouched", () => {
    const r = resolveSessionIdentifier("ses_1234567", { directory: dir })
    expect(r.session_id).toBe("ses_1234567")
    expect(r.resolved_from_alias).toBe(false)
  })

  test("resolves a known alias", async () => {
    await createAlias({ alias: "work", session_id: "ses_aaa11111" }, { directory: dir })
    const r = resolveSessionIdentifier("work", { directory: dir })
    expect(r.session_id).toBe("ses_aaa11111")
    expect(r.resolved_from_alias).toBe(true)
    expect(r.alias).toBe("work")
  })

  test("returns input as-is when alias not found", () => {
    const r = resolveSessionIdentifier("unknown-alias", { directory: dir })
    expect(r.session_id).toBe("unknown-alias")
    expect(r.resolved_from_alias).toBe(false)
  })

  test("trims input but preserves passthrough", () => {
    const r = resolveSessionIdentifier("  ses_abc123  ", { directory: dir })
    expect(r.session_id).toBe("ses_abc123")
  })

  test("does not resolve invalid alias-name input", () => {
    const r = resolveSessionIdentifier("bad name", { directory: dir })
    expect(r.resolved_from_alias).toBe(false)
    expect(r.session_id).toBe("bad name")
  })

  test("empty input returns unchanged without throwing", () => {
    const r = resolveSessionIdentifier("", { directory: dir })
    expect(r.resolved_from_alias).toBe(false)
    expect(r.session_id).toBe("")
  })

  test("refuses to resolve to a tampered session_id (path traversal attempt)", () => {
    // Bypass the manager and inject a malformed alias directly into the file.
    mkdirSync(join(dir, ".opencode"), { recursive: true })
    writeFileSync(
      join(dir, ".opencode", "session-aliases.json"),
      JSON.stringify({
        version: 1,
        aliases: {
          evil: { alias: "evil", session_id: "../../etc/passwd", created_at: 1 },
        },
      }),
      "utf-8",
    )
    const r = resolveSessionIdentifier("evil", { directory: dir })
    expect(r.resolved_from_alias).toBe(false)
    expect(r.session_id).toBe("evil")
  })
})
