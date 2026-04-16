import { describe, it, expect, beforeEach } from "bun:test"
import { parseShebang, detectShebangLanguage, clearShebangCache, getShebangCacheSize, getShebangCacheEntry, SHEBANG_TO_LANG } from "./shebang-detection"
import { mkdtempSync, writeFileSync, rmSync } from "fs"
import { tmpdir } from "os"
import { join } from "path"

describe("parseShebang", () => {
  it("returns null for non-shebang lines", () => {
    expect(parseShebang("const x = 1")).toBeNull()
    expect(parseShebang("")).toBeNull()
    expect(parseShebang("// comment")).toBeNull()
  })

  it("parses simple shebang with absolute path", () => {
    expect(parseShebang("#!/usr/bin/node")).toBe("node")
    expect(parseShebang("#!/bin/bash")).toBe("bash")
    expect(parseShebang("#!/usr/bin/python3")).toBe("python3")
  })

  it("parses shebang with env", () => {
    expect(parseShebang("#!/usr/bin/env node")).toBe("node")
    expect(parseShebang("#!/usr/bin/env python3")).toBe("python3")
    expect(parseShebang("#!/bin/env bash")).toBe("bash")
  })

  it("parses shebang with env -S flag", () => {
    expect(parseShebang("#!/usr/bin/env -S node --experimental-modules")).toBe("node")
    expect(parseShebang("#!/usr/bin/env -S python3 -u")).toBe("python3")
  })

  it("handles relative paths", () => {
    expect(parseShebang("#!/./myinterpreter")).toBe("myinterpreter")
    expect(parseShebang("#!../bin/node")).toBe("node")
  })

  it("trims whitespace", () => {
    expect(parseShebang("  #!/usr/bin/node  ")).toBe("node")
    expect(parseShebang("#!/usr/bin/env   node")).toBe("node")
  })

  it("strips version suffixes", () => {
    expect(parseShebang("#!/usr/bin/python3.11")).toBe("python3")
    expect(parseShebang("#!/usr/bin/lua5.4")).toBe("lua5")
  })

  it("handles interpreter arguments like -e flag", () => {
    expect(parseShebang("#!/bin/bash -e")).toBe("bash")
    expect(parseShebang("#!/usr/bin/bash -ex")).toBe("bash")
    expect(parseShebang("#!/bin/sh -e")).toBe("sh")
    expect(parseShebang("#!/usr/bin/env python3 -u")).toBe("python3")
  })
})

describe("detectShebangLanguage", () => {
  let tmpDir: string

  beforeEach(() => {
    clearShebangCache()
    tmpDir = mkdtempSync(join(tmpdir(), "shebang-test-"))
  })

  it("detects node/javascript scripts", () => {
    const file = join(tmpDir, "myscript")
    writeFileSync(file, "#!/usr/bin/env node\nconsole.log('hello')")
    expect(detectShebangLanguage(file)).toBe("javascript")
  })

  it("detects python scripts", () => {
    const file = join(tmpDir, "script")
    writeFileSync(file, "#!/usr/bin/python3\nprint('hello')")
    expect(detectShebangLanguage(file)).toBe("python")
  })

  it("detects bash scripts", () => {
    const file = join(tmpDir, "deploy")
    writeFileSync(file, "#!/bin/bash\necho hello")
    expect(detectShebangLanguage(file)).toBe("shellscript")
  })

  it("detects ruby scripts", () => {
    const file = join(tmpDir, "rakefile")
    writeFileSync(file, "#!/usr/bin/env ruby\nputs 'hello'")
    expect(detectShebangLanguage(file)).toBe("ruby")
  })

  it("returns null for files without shebang", () => {
    const file = join(tmpDir, "plain")
    writeFileSync(file, "just some text\nmore text")
    expect(detectShebangLanguage(file)).toBeNull()
  })

  it("returns null for unknown interpreters", () => {
    const file = join(tmpDir, "weird")
    writeFileSync(file, "#!/usr/bin/custominterpreter\nblah")
    expect(detectShebangLanguage(file)).toBeNull()
  })

  it("returns null for non-existent files", () => {
    expect(detectShebangLanguage(join(tmpDir, "does-not-exist"))).toBeNull()
  })

  it("caches results", () => {
    const file = join(tmpDir, "cached")
    writeFileSync(file, "#!/bin/bash\necho test")

    expect(getShebangCacheSize()).toBe(0)

    detectShebangLanguage(file)
    expect(getShebangCacheSize()).toBe(1)

    detectShebangLanguage(file)
    expect(getShebangCacheSize()).toBe(1)
  })

  it("handles CRLF line endings", () => {
    const file = join(tmpDir, "crlf")
    writeFileSync(file, "#!/usr/bin/env node\r\nconsole.log('hello')")
    expect(detectShebangLanguage(file)).toBe("javascript")
  })

  it("handles deno as typescript", () => {
    const file = join(tmpDir, "deno-script")
    writeFileSync(file, "#!/usr/bin/env deno\nconsole.log('hello')")
    expect(detectShebangLanguage(file)).toBe("typescript")
  })
})

describe("SHEBANG_TO_LANG mapping", () => {
  it("contains expected interpreters", () => {
    expect(SHEBANG_TO_LANG.node).toBe("javascript")
    expect(SHEBANG_TO_LANG.python3).toBe("python")
    expect(SHEBANG_TO_LANG.bash).toBe("shellscript")
    expect(SHEBANG_TO_LANG.ruby).toBe("ruby")
    expect(SHEBANG_TO_LANG.perl).toBe("perl")
  })
})

describe("clearShebangCache", () => {
  it("clears the cache", () => {
    const file = join(tmpDir, "clear-test")
    writeFileSync(file, "#!/bin/bash\necho test")

    detectShebangLanguage(file)
    expect(getShebangCacheSize()).toBe(1)

    clearShebangCache()
    expect(getShebangCacheSize()).toBe(0)
  })
})

describe("cache invalidation", () => {
  it("invalidates cache when file mtime changes", () => {
    const file = join(tmpDir, "mtime-test")
    writeFileSync(file, "#!/bin/bash\necho test")

    // First detection - should cache
    detectShebangLanguage(file)
    const entry1 = getShebangCacheEntry(file)
    expect(entry1).toBeDefined()
    expect(entry1?.language).toBe("shellscript")
    const mtime1 = entry1?.mtime

    // Re-detect immediately - should use cache
    detectShebangLanguage(file)
    const entry2 = getShebangCacheEntry(file)
    expect(entry2?.mtime).toBe(mtime1)

    // Modify file and re-detect
    writeFileSync(file, "#!/usr/bin/env node\nconsole.log('hello')")
    const result = detectShebangLanguage(file)
    expect(result).toBe("javascript")

    const entry3 = getShebangCacheEntry(file)
    expect(entry3?.language).toBe("javascript")
  })

  it("refreshes recency on cache hit", () => {
    const file1 = join(tmpDir, "recency-test-1")
    const file2 = join(tmpDir, "recency-test-2")
    writeFileSync(file1, "#!/bin/bash\necho test1")
    writeFileSync(file2, "#!/bin/bash\necho test2")

    // Detect both files
    detectShebangLanguage(file1)
    detectShebangLanguage(file2)

    // Access file1 again to refresh its recency
    detectShebangLanguage(file1)

    // Verify cache has both entries
    expect(getShebangCacheSize()).toBe(2)
  })
})
