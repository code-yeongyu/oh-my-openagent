import { afterEach, describe, expect, it } from "bun:test"
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import {
  MANAGED_CUSTOM_OPENCODE_ASSET_DIR,
  SYNC_LOG_FILENAME,
  SYNC_MANIFEST_FILENAME,
  SYNC_STATE_DIRNAME,
  syncCustomOpenCodeAssets,
  type SyncManifest,
} from "../../../../script/sync-custom-opencode-assets"

const FIXED_TIMESTAMP = "2026-03-30T12:34:56.789Z"
const tempDirs: string[] = []

function createTempDir(): string {
  const tempDir = mkdtempSync(join(tmpdir(), "custom-opencode-assets-"))
  tempDirs.push(tempDir)
  return tempDir
}

afterEach(() => {
  for (const tempDir of tempDirs.splice(0)) {
    rmSync(tempDir, { recursive: true, force: true })
  }
})

describe("custom OpenCode asset sync", () => {
  it("syncs the managed asset tree into a temporary target with manifest output", async () => {
    const targetDir = createTempDir()

    const result = await syncCustomOpenCodeAssets({
      targetDir,
      timestamp: FIXED_TIMESTAMP,
    })

    const stateDir = join(targetDir, SYNC_STATE_DIRNAME)
    const manifestPath = join(stateDir, SYNC_MANIFEST_FILENAME)
    const logPath = join(stateDir, SYNC_LOG_FILENAME)

    expect(existsSync(join(targetDir, "oh-my-opencode.json"))).toBe(true)
    expect(existsSync(join(targetDir, "opencode.json"))).toBe(true)
    expect(existsSync(join(targetDir, "plugins", "heartbeat-status.js"))).toBe(true)
    expect(existsSync(join(targetDir, "plugins", "oh-my-openagent.js"))).toBe(true)
    expect(existsSync(join(targetDir, "plugins", "tls-certificate-retry.js"))).toBe(true)
    expect(existsSync(join(targetDir, "refresh-omo.ps1"))).toBe(true)
    expect(statSync(join(targetDir, "plugins")).isDirectory()).toBe(true)
    expect(existsSync(manifestPath)).toBe(true)
    expect(existsSync(logPath)).toBe(true)
    expect(existsSync(result.backupDir)).toBe(true)

    const manifest = JSON.parse(readFileSync(manifestPath, "utf-8")) as SyncManifest
    expect(manifest.targetDir).toBe(targetDir)
    expect(manifest.summary).toEqual({
      created: 6,
      updated: 0,
      unchanged: 0,
      backups: 0,
    })
    expect(manifest.files.map((file) => file.relativePath)).toEqual([
      "oh-my-opencode.json",
      "opencode.json",
      "plugins/heartbeat-status.js",
      "plugins/oh-my-openagent.js",
      "plugins/tls-certificate-retry.js",
      "refresh-omo.ps1",
    ])
    expect(manifest.createdDirectories).toContain(".oh-my-openagent-sync")
    expect(manifest.createdDirectories).toContain("plugins")

    const logContents = readFileSync(logPath, "utf-8")
    expect(logContents).toContain("[CREATED] oh-my-opencode.json")
    expect(logContents).toContain("[CREATED] opencode.json")
    expect(logContents).toContain("[CREATED] plugins/heartbeat-status.js")
    expect(logContents).toContain("[CREATED] plugins/oh-my-openagent.js")
    expect(logContents).toContain("[CREATED] plugins/tls-certificate-retry.js")
    expect(logContents).toContain("[CREATED] refresh-omo.ps1")
  })

  it("backs up an existing target file before overwrite", async () => {
    const targetDir = createTempDir()
    const preexistingOpencodeContents = '{\n  "legacy": true\n}\n'
    const targetOpencodePath = join(targetDir, "opencode.json")
    const managedOpencodePath = join(MANAGED_CUSTOM_OPENCODE_ASSET_DIR, "opencode.json")

    writeFileSync(targetOpencodePath, preexistingOpencodeContents)

    const result = await syncCustomOpenCodeAssets({
      targetDir,
      timestamp: FIXED_TIMESTAMP,
    })

    const manifestPath = join(targetDir, SYNC_STATE_DIRNAME, SYNC_MANIFEST_FILENAME)
    const logPath = join(targetDir, SYNC_STATE_DIRNAME, SYNC_LOG_FILENAME)
    const backupPath = join(result.backupDir, "opencode.json")
    const managedOpencodeContents = readFileSync(managedOpencodePath, "utf-8")
    const syncedOpencodeContents = readFileSync(targetOpencodePath, "utf-8")
    const manifest = JSON.parse(readFileSync(manifestPath, "utf-8")) as SyncManifest
    const opencodeRecord = manifest.files.find((file) => file.relativePath === "opencode.json")

    expect(existsSync(backupPath)).toBe(true)
    expect(readFileSync(backupPath, "utf-8")).toBe(preexistingOpencodeContents)
    expect(syncedOpencodeContents).toBe(managedOpencodeContents)
    expect(opencodeRecord?.status).toBe("updated")
    expect(opencodeRecord?.backupPath).toBe(backupPath)
    expect(manifest.summary.updated).toBe(1)
    expect(manifest.summary.backups).toBe(1)
    expect(readFileSync(logPath, "utf-8")).toContain(`backup: ${backupPath}`)
  })
})
