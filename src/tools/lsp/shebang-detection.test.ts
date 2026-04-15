import { describe, it, expect, beforeEach } from "bun:test"
import { parseShebang, detectShebangLanguage, clearShebangCache, getShebangCacheSize, SHEBANG_TO_LANG } from "./shebang-detection"
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
