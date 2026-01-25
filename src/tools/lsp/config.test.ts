import { describe, test, expect, beforeEach, afterEach } from "bun:test"
import { isServerInstalled, findServerForExtension } from "./config"
import { mkdtempSync, rmSync, writeFileSync } from "fs"
import { join } from "path"
import { tmpdir } from "os"

describe("isServerInstalled", () => {
  let tempDir: string
  let savedEnv: { [key: string]: string | undefined }

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "lsp-config-test-"))
    savedEnv = {
      PATH: process.env.PATH,
      Path: process.env.Path,
      PATHEXT: process.env.PATHEXT,
    }
  })

  afterEach(() => {
    try {
      rmSync(tempDir, { recursive: true, force: true })
    } catch (e) {
      console.error(`Failed to clean up temp dir: ${e}`)
    }

    if (process.platform === "win32") {
      const pathVal = savedEnv.PATH ?? savedEnv.Path
      if (pathVal === undefined) {
        delete process.env.PATH
        delete process.env.Path
      } else {
        process.env.PATH = pathVal
        process.env.Path = pathVal
      }
    } else {
      if (savedEnv.PATH === undefined) {
        delete process.env.PATH
      } else {
        process.env.PATH = savedEnv.PATH
      }

      if (savedEnv.Path === undefined) {
        delete process.env.Path
      } else {
        process.env.Path = savedEnv.Path
      }
    }

    const pathextVal = savedEnv.PATHEXT
    if (pathextVal === undefined) {
      delete process.env.PATHEXT
    } else {
      process.env.PATHEXT = pathextVal
    }
  })

  test("detects executable in PATH", () => {
    const binName = "test-lsp-server"
    const ext = process.platform === "win32" ? ".cmd" : ""
    const binPath = join(tempDir, binName + ext)
    
    writeFileSync(binPath, "echo hello")
    
    const pathSep = process.platform === "win32" ? ";" : ":"
    process.env.PATH = `${tempDir}${pathSep}${process.env.PATH || ""}`

    expect(isServerInstalled([binName])).toBe(true)
  })

  test("returns false for missing executable", () => {
    expect(isServerInstalled(["non-existent-server"])).toBe(false)
  })

  if (process.platform === "win32") {
    test("Windows: detects executable with Path env var", () => {
       const binName = "test-lsp-server-case"
       const binPath = join(tempDir, binName + ".cmd")
       writeFileSync(binPath, "echo hello")

       delete process.env.PATH
       process.env.Path = tempDir

       expect(isServerInstalled([binName])).toBe(true)
    })

    test("Windows: respects PATHEXT", () => {
       const binName = "test-lsp-server-custom"
       const binPath = join(tempDir, binName + ".COM")
       writeFileSync(binPath, "echo hello")

       process.env.PATH = tempDir
       process.env.PATHEXT = ".COM;.EXE"

       expect(isServerInstalled([binName])).toBe(true)
    })
    
    test("Windows: ensures default extensions are checked even if PATHEXT is missing", () => {
       const binName = "test-lsp-server-default"
       const binPath = join(tempDir, binName + ".bat")
       writeFileSync(binPath, "echo hello")

       process.env.PATH = tempDir
       delete process.env.PATHEXT

       expect(isServerInstalled([binName])).toBe(true)
    })

    test("Windows: ensures default extensions are checked even if PATHEXT does not include them", () => {
        const binName = "test-lsp-server-ps1"
        const binPath = join(tempDir, binName + ".ps1")
        writeFileSync(binPath, "echo hello")
 
        process.env.PATH = tempDir
        process.env.PATHEXT = ".COM"
 
        expect(isServerInstalled([binName])).toBe(true)
     })
   } else {
       test("Non-Windows: does not use windows extensions", () => {
           const binName = "test-lsp-server-win"
           const binPath = join(tempDir, binName + ".cmd")
           writeFileSync(binPath, "echo hello")
           
           process.env.PATH = tempDir
           
           expect(isServerInstalled([binName])).toBe(false)
       })
   }
})

describe("findServerForExtension with tsgo", () => {
  let tempDir: string
  let tempConfigDir: string
  let tempDataDir: string
  let savedEnv: { 
    PATH?: string
    Path?: string
    OPENCODE_CONFIG_DIR?: string
    XDG_DATA_HOME?: string
  }
  let savedCwd: string

  beforeEach(() => {
    // #given isolated temp environment
    tempDir = mkdtempSync(join(tmpdir(), "lsp-tsgo-test-"))
    tempConfigDir = mkdtempSync(join(tmpdir(), "lsp-tsgo-config-"))
    tempDataDir = mkdtempSync(join(tmpdir(), "lsp-tsgo-data-"))
    
    savedEnv = { 
      PATH: process.env.PATH,
      Path: process.env.Path,
      OPENCODE_CONFIG_DIR: process.env.OPENCODE_CONFIG_DIR,
      XDG_DATA_HOME: process.env.XDG_DATA_HOME
    }
    savedCwd = process.cwd()
    
    // Isolate from real configs and data dirs
    process.env.OPENCODE_CONFIG_DIR = tempConfigDir
    process.env.XDG_DATA_HOME = tempDataDir
    process.chdir(tempDir)
  })

  afterEach(() => {
    // Restore original environment
    process.chdir(savedCwd)
    
    process.env.PATH = savedEnv.PATH
    if (process.platform === "win32") {
      process.env.Path = savedEnv.Path
    }
    
    // Restore or delete env vars
    for (const key of ["OPENCODE_CONFIG_DIR", "XDG_DATA_HOME"] as const) {
      if (savedEnv[key] !== undefined) {
        process.env[key] = savedEnv[key]
      } else {
        delete process.env[key]
      }
    }
    
    try {
      rmSync(tempDir, { recursive: true, force: true })
      rmSync(tempConfigDir, { recursive: true, force: true })
      rmSync(tempDataDir, { recursive: true, force: true })
    } catch (e) {
      console.error(`Cleanup failed: ${e}`)
    }
  })

  // Helper to create fake binary with platform-specific extension
  function createFakeBinary(name: string): void {
    const ext = process.platform === "win32" ? ".cmd" : ""
    const binPath = join(tempDir, name + ext)
    writeFileSync(binPath, process.platform === "win32" ? "@echo off" : "#!/bin/sh\nexit 0")
  }

  // Helper to set PATH on both Windows and Unix deterministically
  function setPath(pathValue: string): void {
    process.env.PATH = pathValue
    if (process.platform === "win32") {
      process.env.Path = pathValue
    }
  }

  test("selects tsgo over typescript when both are installed", () => {
    // #given BOTH tsgo and typescript-language-server binaries exist in PATH
    createFakeBinary("tsgo")
    createFakeBinary("typescript-language-server")
    
    const pathSep = process.platform === "win32" ? ";" : ":"
    setPath(tempDir + pathSep + (savedEnv.PATH || ""))

    // #when findServerForExtension is called for .ts
    const result = findServerForExtension(".ts")

    // #then tsgo should be selected (PREFER_WHEN_INSTALLED: users who install preview tools want them)
    expect(result.status).toBe("found")
    if (result.status === "found") {
      expect(result.server.id).toBe("tsgo")
    }
  })

  test("falls back to typescript when only typescript-language-server is installed", () => {
    // #given ONLY typescript-language-server exists in PATH (no tsgo)
    createFakeBinary("typescript-language-server")
    
    const pathSep = process.platform === "win32" ? ";" : ":"
    setPath(tempDir + pathSep + (savedEnv.PATH || ""))

    // #when findServerForExtension is called for .ts
    const result = findServerForExtension(".ts")

    // #then typescript should be selected as fallback
    expect(result.status).toBe("found")
    if (result.status === "found") {
      expect(result.server.id).toBe("typescript")
    }
  })

  test("returns not_installed when neither tsgo nor typescript-language-server is installed", () => {
    // #given NO TypeScript-related LSP servers in PATH
    setPath(tempDir)

    // #when findServerForExtension is called for .ts
    const result = findServerForExtension(".ts")

    // #then status should be not_installed with highest-priority server's details (typescript)
    expect(result.status).toBe("not_installed")
    if (result.status === "not_installed") {
      expect(result.server.id).toBe("typescript")
      expect(result.installHint).toContain("typescript-language-server")
    }
  })
})
