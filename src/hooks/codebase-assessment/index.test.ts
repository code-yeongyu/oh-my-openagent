import { describe, it, expect } from "bun:test"
import { HOOK_NAME, CONFIG_FILES, CODEBASE_STATES } from "./constants"
import { collectProjectConfig } from "./collector"
import { join } from "node:path"
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from "node:fs"
import { tmpdir } from "node:os"

describe("codebase-assessment constants", () => {
  // #given constants are exported
  // #when accessing constant values
  // #then they should have expected values

  it("should export correct hook name", () => {
    expect(HOOK_NAME).toBe("codebase-assessment")
  })

  it("should include common config files", () => {
    expect(CONFIG_FILES).toContain("package.json")
    expect(CONFIG_FILES).toContain("tsconfig.json")
    expect(CONFIG_FILES).toContain(".eslintrc.json")
    expect(CONFIG_FILES).toContain(".prettierrc")
  })

  it("should define all codebase states", () => {
    expect(CODEBASE_STATES.DISCIPLINED).toBe("disciplined")
    expect(CODEBASE_STATES.TRANSITIONAL).toBe("transitional")
    expect(CODEBASE_STATES.LEGACY).toBe("legacy")
    expect(CODEBASE_STATES.GREENFIELD).toBe("greenfield")
  })
})

describe("codebase-assessment collector", () => {
  // #given a temporary directory with various config files
  // #when collectProjectConfig is called
  // #then it should correctly identify project characteristics

  let tempDir: string

  it("should detect disciplined codebase", () => {
    tempDir = mkdtempSync(join(tmpdir(), "test-disciplined-"))
    
    // Create config files for disciplined project
    writeFileSync(join(tempDir, "package.json"), "{}")
    writeFileSync(join(tempDir, "tsconfig.json"), "{}")
    writeFileSync(join(tempDir, ".eslintrc.json"), "{}")
    writeFileSync(join(tempDir, ".prettierrc"), "{}")
    writeFileSync(join(tempDir, "vitest.config.ts"), "export default {}")
    writeFileSync(join(tempDir, "bun.lockb"), "")
    
    const result = collectProjectConfig(tempDir)
    
    expect(result.state).toBe("disciplined")
    expect(result.hasLinter).toBe(true)
    expect(result.hasFormatter).toBe(true)
    expect(result.hasTypeScript).toBe(true)
    expect(result.hasTests).toBe(true)
    expect(result.packageManager).toBe("bun")
    
    rmSync(tempDir, { recursive: true })
  })

  it("should detect greenfield codebase", () => {
    tempDir = mkdtempSync(join(tmpdir(), "test-greenfield-"))
    
    // Only package.json
    writeFileSync(join(tempDir, "package.json"), "{}")
    
    const result = collectProjectConfig(tempDir)
    
    expect(result.state).toBe("greenfield")
    expect(result.configFilesFound.length).toBeLessThanOrEqual(2)
    
    rmSync(tempDir, { recursive: true })
  })

  it("should detect transitional codebase", () => {
    tempDir = mkdtempSync(join(tmpdir(), "test-transitional-"))
    
    // Some but not all configs
    writeFileSync(join(tempDir, "package.json"), "{}")
    writeFileSync(join(tempDir, "tsconfig.json"), "{}")
    writeFileSync(join(tempDir, ".eslintrc.json"), "{}")
    
    const result = collectProjectConfig(tempDir)
    
    expect(result.state).toBe("transitional")
    expect(result.hasLinter).toBe(true)
    expect(result.hasTypeScript).toBe(true)
    expect(result.hasFormatter).toBe(false)
    
    rmSync(tempDir, { recursive: true })
  })

  it("should detect package manager correctly", () => {
    tempDir = mkdtempSync(join(tmpdir(), "test-npm-"))
    
    writeFileSync(join(tempDir, "package.json"), "{}")
    writeFileSync(join(tempDir, "package-lock.json"), "{}")
    
    const result = collectProjectConfig(tempDir)
    
    expect(result.packageManager).toBe("npm")
    
    rmSync(tempDir, { recursive: true })
  })

  it("should generate appropriate recommendations", () => {
    tempDir = mkdtempSync(join(tmpdir(), "test-rec-"))
    
    writeFileSync(join(tempDir, "package.json"), "{}")
    
    const result = collectProjectConfig(tempDir)
    
    expect(result.recommendation).toBeTruthy()
    expect(typeof result.recommendation).toBe("string")
    
    rmSync(tempDir, { recursive: true })
  })
})
