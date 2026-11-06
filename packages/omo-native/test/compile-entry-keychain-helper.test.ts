import { afterAll, describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { keychainProcessState } from "../../omo-opencode/src/cli/service-auth/keychain-helper/process-state"
import { compiledKeychainHelper, runCompiledLauncher } from "../compile-entry"

const execDir = mkdtempSync(join(tmpdir(), "compiled-exec-"))
afterAll(() => rmSync(execDir, { recursive: true, force: true }))

describe("compiled binary: the keychain helper beside it serves every command (#11262 v9 shape B)", () => {
  test("#given any command #when the compiled launcher starts #then execDir/omo-keychain is the first helper candidate", async () => {
    writeFileSync(join(execDir, "package.json"), JSON.stringify({ version: "0.0.0-test" }))
    const exitCode = process.exitCode
    try {
      expect(await runCompiledLauncher(["ulw-loop"], execDir)).toBe(true)
    } finally {
      process.exitCode = exitCode ?? 0
    }
    expect(keychainProcessState().entryCandidates[0]).toBe(compiledKeychainHelper(execDir))
    // RULING-74, desktop#5057: omo-keychain directly beside the runtime binary.
    expect(compiledKeychainHelper("/opt/omo")).toBe("/opt/omo/omo-keychain")
  })
})
