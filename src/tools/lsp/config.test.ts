import { describe, test, expect, beforeEach, afterEach } from "bun:test"
import { isServerInstalled } from "./config"
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
