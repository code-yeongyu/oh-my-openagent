import { afterEach, describe, expect, it, setDefaultTimeout } from "bun:test"
import { existsSync } from "node:fs"
import { join } from "node:path"
import { HOOK_SECRET_PATTERNS } from "./hooks-scripts"
import { commit, createRepo, removeTempDirs, run, tempDir, writeFiles } from "./hooks.test-support"
import { SECRET_PATTERN_SOURCES, scanSecretLikeMaterial } from "../sync/redact"

afterEach(removeTempDirs)

setDefaultTimeout(process.platform === "win32" ? 30000 : 5000)

describe("pre-commit hook secret screening", () => {
  it("#given a staged file carrying a vendor token #when committed #then the hook refuses naming the class, never the token", async () => {
    // given
    const dir = await createRepo()
    const token = "xoxb-1234567890abcdefghij"

    // when
    const result = await commit(dir, { "reference/z.md": `---\ndescription: Z\n---\n\n${token}\n` })

    // then
    expect(result.code).not.toBe(0)
    expect(result.stderr).toContain("secret-like content (vendor_token)")
    expect(result.stderr).not.toContain(token)
    expect((await run(["git", "log", "--oneline"], dir)).code).not.toBe(0)
  })

  it("#given a staged file whose path contains a space #when committed with a vendor token #then the hook still scans and refuses it", async () => {
    // given
    const dir = await createRepo()
    const token = "xoxb-1234567890abcdefghij"

    // when
    const result = await commit(dir, { "reference/with space.md": `---\ndescription: Z\n---\n\n${token}\n` })

    // then
    expect(result.code).not.toBe(0)
    expect(result.stderr).toContain("secret-like content (vendor_token)")
  })

  it("#given file names carrying shell metacharacters #when committed with a vendor token #then the hook refuses without evaluating the name", async () => {
    // given: one fresh repository per name, so an earlier refused file cannot stay staged and fail
    // a later commit on its own; each name would execute if the hook interpolated it into sh source
    const token = "xoxb-1234567890abcdefghij"
    const body = `---\ndescription: Z\n---\n\n${token}\n`
    const names = ["reference/$(printf probe).md", "reference/\u0060id\u0060.md"]

    for (const name of names) {
      const dir = await createRepo()

      // when
      const result = await commit(dir, { [name]: body }, "probe")

      // then: the name's own blob is refused, and no probe/id side effect ran
      expect(result.code).not.toBe(0)
      expect(result.stderr).toContain("secret-like content (vendor_token)")
      expect(result.stderr).not.toContain(token)
      expect(existsSync(join(dir, "probe"))).toBe(false)
      expect(result.stderr).not.toMatch(/^\d+$/m)
    }
  }, 30_000)

  it("#given file names git quotes in its output #when committed with a vendor token #then the hook still scans each blob and refuses", async () => {
    // given: git C-quotes names with non-ASCII bytes, quotes, backslashes and newlines; quotes,
    // backslashes and newlines cannot be Windows file names, so those run on POSIX only
    const body = "---\ndescription: Z\n---\n\nxoxb-1234567890abcdefghij\n"
    const portable = ["reference/\uD55C\uAE00.md", "reference/caf\u00e9.md"]
    const posixOnly = ["reference/a'b\"c.md", "reference/back\\slash.md", "reference/new\nline.md"]
    const names = process.platform === "win32" ? portable : [...portable, ...posixOnly]

    for (const name of names) {
      const dir = await createRepo()

      // when
      const result = await commit(dir, { [name]: body }, "probe")

      // then
      expect(result.code).not.toBe(0)
      expect(result.stderr).toContain("secret-like content (vendor_token)")
      expect((await run(["git", "log", "--oneline"], dir)).code).not.toBe(0)
    }
  }, 60_000)

  it("#given a rename that also adds a vendor token #when committed #then the hook scans the new blob and refuses", async () => {
    // given: git detects renames by default, so a moved file shows as R, not A or M
    const dir = await createRepo()
    const body = `---\ndescription: Z\n---\n\n${"line\n".repeat(40)}`
    await commit(dir, { "reference/old.md": body }, "seed")
    await run(["git", "mv", "reference/old.md", "reference/new.md"], dir)
    await writeFiles(dir, { "reference/new.md": `${body}xoxb-1234567890abcdefghij\n` })
    await run(["git", "add", "-A"], dir)

    // when
    const result = await run(["git", "commit", "-m", "move"], dir)

    // then
    expect(result.code).not.toBe(0)
    expect(result.stderr).toContain("reference/new.md contains secret-like content (vendor_token)")
  }, 30_000)

  it("#given a staged deletion #when committed #then the hook does not read a missing blob and commits", async () => {
    // given
    const dir = await createRepo()
    await commit(dir, { "reference/old.md": "---\ndescription: Old\n---\n\nold\n" })
    await run(["git", "rm", "-q", "reference/old.md"], dir)

    // when
    const result = await run(["git", "commit", "-m", "remove old"], dir)

    // then
    expect(result.code).toBe(0)
  })

  it("#given a clean staged blob whose worktree copy carries a token #when committed #then the hook commits the clean index", async () => {
    // given: the hook reads the index, never the worktree
    const dir = await createRepo()
    await writeFiles(dir, { "reference/x.md": "---\ndescription: X\n---\n\nclean\n" })
    await run(["git", "add", "-A"], dir)
    await writeFiles(dir, { "reference/x.md": "---\ndescription: X\n---\n\nxoxb-1234567890abcdefghij\n" })

    // when
    const result = await run(["git", "commit", "-m", "staged clean"], dir)

    // then
    expect(result.code).toBe(0)
    expect((await run(["git", "show", "HEAD:reference/x.md"], dir)).stdout).toContain("clean")
  })

  it("#given a clean commit #when committed #then it succeeds", async () => {
    // given
    const dir = await createRepo()

    // when
    const result = await commit(dir, { "reference/ok.md": "---\ndescription: Ok\n---\n\nordinary note\n" })

    // then
    expect(result.code).toBe(0)
  })

  it("#given a prose-only file #when committed #then the hook does not fire", async () => {
    // given
    const dir = await createRepo()

    // when
    const result = await commit(dir, { "reference/policy.md": "---\ndescription: Policy\n---\n\npassword policy doc\nthe token budget is 30000 tokens\n" })

    // then
    expect(result.code).toBe(0)
  })
})

describe("hook secret pattern parity", () => {
  it("#given the hook ERE table #when compared with the TypeScript classes #then the class order matches", () => {
    expect(HOOK_SECRET_PATTERNS.map((entry): string => entry.class)).toEqual(
      SECRET_PATTERN_SOURCES.map((entry): string => entry[0]),
    )
  })

  const samples: readonly { class: string; positive: string; prose: string }[] = [
    { class: "aws_access_key", positive: "the key is AKIAABCDEFGHIJKLMNOP here", prose: "akia is not a key prefix" },
    { class: "credential_assignment", positive: "token=abc123456", prose: "the token budget is 30000 tokens" },
    { class: "authorization_header", positive: "Authorization: Bearer abcdef123456", prose: "authorization policy" },
    { class: "openai_key", positive: "sk-proj-AAAABBBBCCCC", prose: "sk- alone is not a key" },
    { class: "vendor_token", positive: "xoxb-1234567890abcdefghij", prose: "ghp without separator" },
  ]

  for (const { class: cls, positive, prose } of samples) {
    it(`#given the ${cls} ERE #when run through host grep -E #then it matches the sample the TypeScript class matches and rejects the prose control`, async () => {
      // given
      const entry = HOOK_SECRET_PATTERNS.find((candidate) => candidate.class === cls)
      if (entry === undefined) throw new Error(`missing hook class ${cls}`)
      const dir = await tempDir("memory-hook-ere-")

      // when
      await writeFiles(dir, { "positive.txt": positive, "prose.txt": prose })
      const pos = await run(["sh", "-c", `grep -E -q -e '${entry.ere}' positive.txt`], dir)
      const neg = await run(["sh", "-c", `grep -E -q -e '${entry.ere}' prose.txt`], dir)

      // then: the same positive the TypeScript scanner flags, and the prose control stays clean
      expect(pos.code).toBe(0)
      expect(neg.code).not.toBe(0)
      expect(scanSecretLikeMaterial(positive).length).toBeGreaterThan(0)
      expect(scanSecretLikeMaterial(prose)).toEqual([])
    })
  }
})
