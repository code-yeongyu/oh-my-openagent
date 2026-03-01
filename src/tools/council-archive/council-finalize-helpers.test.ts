import { describe, expect, it, beforeEach, afterEach } from "bun:test"
import { join } from "node:path"
import { slugify, toPosixPath, extractAgentFromFrontmatter, isPathEscaping, movePromptFile } from "./council-finalize-helpers"

describe("slugify", () => {
  describe("#given an empty string", () => {
    it("#then returns empty string", () => {
      expect(slugify("")).toBe("")
    })
  })

  describe("#given special characters only", () => {
    it("#then returns empty string", () => {
      expect(slugify("@#$%")).toBe("")
    })
  })

  describe("#given normal text with spaces", () => {
    it("#then returns lowercased hyphenated string", () => {
      expect(slugify("Hello World")).toBe("hello-world")
    })
  })

  describe("#given leading and trailing hyphens after conversion", () => {
    it("#then strips leading and trailing hyphens", () => {
      expect(slugify("--hello--")).toBe("hello")
    })
  })

  describe("#given multiple consecutive special characters", () => {
    it("#then collapses them into a single hyphen", () => {
      expect(slugify("foo!!!bar")).toBe("foo-bar")
    })
  })

  describe("#given mixed alphanumeric and special characters", () => {
    it("#then returns only alphanumeric parts joined by hyphens", () => {
      expect(slugify("Council: Claude Opus")).toBe("council-claude-opus")
    })
  })
})

describe("toPosixPath", () => {
  describe("#given a Windows backslash path", () => {
    it("#then replaces all backslashes with forward slashes", () => {
      expect(toPosixPath("foo\\bar\\baz")).toBe("foo/bar/baz")
    })
  })

  describe("#given an already-posix path", () => {
    it("#then returns the path unchanged", () => {
      expect(toPosixPath("foo/bar/baz")).toBe("foo/bar/baz")
    })
  })

  describe("#given mixed separators", () => {
    it("#then converts all backslashes to forward slashes", () => {
      expect(toPosixPath("foo\\bar/baz\\qux")).toBe("foo/bar/baz/qux")
    })
  })
})

describe("extractAgentFromFrontmatter", () => {
  describe("#given valid frontmatter with agent field", () => {
    it("#then returns the agent name", () => {
      const content = "---\nagent: Council: Claude Opus\nsession_id: ses_test\n---\nsome body"
      expect(extractAgentFromFrontmatter(content)).toBe("Council: Claude Opus")
    })
  })

  describe("#given content with no frontmatter", () => {
    it("#then returns null", () => {
      const content = "Just some plain text without frontmatter"
      expect(extractAgentFromFrontmatter(content)).toBeNull()
    })
  })

  describe("#given frontmatter without agent field", () => {
    it("#then returns null", () => {
      const content = "---\ntask_id: bg_001\nsession_id: ses_test\n---\nbody"
      expect(extractAgentFromFrontmatter(content)).toBeNull()
    })
  })

  describe("#given malformed frontmatter with no closing delimiter", () => {
    it("#then returns null", () => {
      const content = "---\nagent: Council: Claude Opus\nsession_id: ses_test\nbody without closing"
      expect(extractAgentFromFrontmatter(content)).toBeNull()
    })
  })

  describe("#given agent value with extra whitespace", () => {
    it("#then returns trimmed agent name", () => {
      const content = "---\nagent:   Council: GPT-5   \n---\nbody"
      expect(extractAgentFromFrontmatter(content)).toBe("Council: GPT-5")
    })
  })
})

describe("isPathEscaping", () => {
  const root = "/base/project/.sisyphus/tmp"

  describe("#given a path with ../ traversal", () => {
    it("#then returns true", () => {
      expect(isPathEscaping(root, "/base/project/.sisyphus/../secret")).toBe(true)
    })
  })

  describe("#given a path that resolves to parent via ..", () => {
    it("#then returns true", () => {
      expect(isPathEscaping("/base/root", "/base")).toBe(true)
    })
  })

  describe("#given an absolute path that is outside the root", () => {
    it("#then returns true", () => {
      expect(isPathEscaping(root, "/etc/passwd")).toBe(true)
    })
  })

  describe("#given a path named ..config (not a traversal)", () => {
    it("#then returns false — this is the L3 fix critical test case", () => {
      const target = join(root, "..config")
      expect(isPathEscaping(root, target)).toBe(false)
    })
  })

  describe("#given a safe relative path inside root", () => {
    it("#then returns false", () => {
      const target = join(root, "athena-council-test.md")
      expect(isPathEscaping(root, target)).toBe(false)
    })
  })

  describe("#given a nested path inside root", () => {
    it("#then returns false", () => {
      const target = join(root, "subdir", "file.md")
      expect(isPathEscaping(root, target)).toBe(false)
    })
  })
})

describe("movePromptFile", () => {
  let tmpDir: string
  let absArchiveDir: string
  let relArchiveDir: string

  beforeEach(async () => {
    const { mkdtemp, mkdir } = await import("node:fs/promises")
    const { tmpdir } = await import("node:os")
    tmpDir = await mkdtemp(join(tmpdir(), "council-helpers-test-"))
    await mkdir(join(tmpDir, ".sisyphus", "tmp"), { recursive: true })
    await mkdir(join(tmpDir, ".sisyphus", "athena", "council-test-abcd"), { recursive: true })
    absArchiveDir = join(tmpDir, ".sisyphus", "athena", "council-test-abcd")
    relArchiveDir = ".sisyphus/athena/council-test-abcd"
  })

  afterEach(async () => {
    const { rm } = await import("node:fs/promises")
    await rm(tmpDir, { recursive: true, force: true })
  })

  describe("#given a valid prompt file and successful rename (same filesystem)", () => {
    it("#then returns the relative posix path to the moved file", async () => {
      const { writeFile } = await import("node:fs/promises")
      const promptSrc = join(tmpDir, ".sisyphus", "tmp", "athena-council-test.md")
      await writeFile(promptSrc, "prompt content", "utf-8")

      const result = await movePromptFile(".sisyphus/tmp/athena-council-test.md", tmpDir, absArchiveDir, relArchiveDir)

      expect(result).toBe(".sisyphus/athena/council-test-abcd/council-prompt.md")
    })
  })

  describe("#given a valid prompt file that is moved (destination readable)", () => {
    it("#then the destination file contains the original content", async () => {
      const { writeFile, readFile } = await import("node:fs/promises")
      const promptSrc = join(tmpDir, ".sisyphus", "tmp", "my-prompt.md")
      await writeFile(promptSrc, "council prompt body", "utf-8")

      await movePromptFile(".sisyphus/tmp/my-prompt.md", tmpDir, absArchiveDir, relArchiveDir)

      const dest = join(absArchiveDir, "council-prompt.md")
      const content = await readFile(dest, "utf-8")
      expect(content).toBe("council prompt body")
    })
  })

  describe("#given a prompt file path that escapes .sisyphus/tmp/", () => {
    it("#then returns undefined without creating destination file", async () => {
      const result = await movePromptFile("/etc/passwd", tmpDir, absArchiveDir, relArchiveDir)

      expect(result).toBeUndefined()
    })
  })

  describe("#given a relative traversal prompt file path", () => {
    it("#then returns undefined", async () => {
      const result = await movePromptFile("../../etc/passwd", tmpDir, absArchiveDir, relArchiveDir)

      expect(result).toBeUndefined()
    })
  })
})
