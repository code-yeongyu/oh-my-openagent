import { describe, it, expect, beforeEach } from "bun:test"
import { getLanguageId } from "./language-config"
import { detectShebangLanguage, clearShebangCache } from "./shebang-detection"
import { mkdtempSync, writeFileSync, rmSync } from "fs"
import { tmpdir } from "os"
import { join } from "path"

describe("getLanguageId", () => {
  let tmpDir: string

  beforeEach(() => {
    clearShebangCache()
    tmpDir = mkdtempSync(join(tmpdir(), "lang-config-test-"))
  })

  it("returns language for known extensions", () => {
    expect(getLanguageId("/path/to/file.ts", ".ts")).toBe("typescript")
    expect(getLanguageId("/path/to/file.js", ".js")).toBe("javascript")
    expect(getLanguageId("/path/to/file.py", ".py")).toBe("python")
    expect(getLanguageId("/path/to/file.rs", ".rs")).toBe("rust")
  })

  it("returns plaintext for unknown extensions", () => {
    expect(getLanguageId("/path/to/file.xyz", ".xyz")).toBe("plaintext")
    expect(getLanguageId("/path/to/file", "")).toBe("plaintext")
  })

  it("detects language from shebang for files without extension", () => {
    const nodeScript = join(tmpDir, "nodescript")
    writeFileSync(nodeScript, "#!/usr/bin/env node\nconsole.log('hello')")
    expect(getLanguageId(nodeScript, "")).toBe("javascript")

    const pyScript = join(tmpDir, "pyscript")
    writeFileSync(pyScript, "#!/usr/bin/python3\nprint('hello')")
    expect(getLanguageId(pyScript, "")).toBe("python")

    const bashScript = join(tmpDir, "deploy")
    writeFileSync(bashScript, "#!/bin/bash\necho hello")
    expect(getLanguageId(bashScript, "")).toBe("shellscript")
  })

  it("returns plaintext for extensionless files without shebang", () => {
    const plainFile = join(tmpDir, "plainfile")
    writeFileSync(plainFile, "just some text content")
    expect(getLanguageId(plainFile, "")).toBe("plaintext")
  })

  it("prefers extension over shebang when both present", () => {
    const file = join(tmpDir, "script.ts")
    writeFileSync(file, "#!/usr/bin/env node\nconst x: number = 1")
    expect(getLanguageId(file, ".ts")).toBe("typescript")
  })

  it("handles Makefile (special case with no extension)", () => {
    const makefile = join(tmpDir, "Makefile")
    writeFileSync(makefile, "all:\n\techo hello")
    expect(getLanguageId(makefile, "")).toBe("plaintext")
  })
})
