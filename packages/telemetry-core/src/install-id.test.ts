import { describe, expect, test } from "bun:test"
import { createHash } from "node:crypto"
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { TELEMETRY_INSTALL_ID_FILE_NAME, getTelemetryInstallDistinctId } from "./install-id"

function withStateDir(run: (stateDir: string) => void): void {
  const root = mkdtempSync(join(tmpdir(), "telemetry-install-id-"))
  try {
    run(join(root, "state"))
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

describe("getTelemetryInstallDistinctId", () => {
  test("#given an empty state dir #when the distinct id is read twice #then one random 0600 id is minted, kept, and only its hash is returned", () => {
    withStateDir((stateDir) => {
      // when
      const first = getTelemetryInstallDistinctId(stateDir)
      const second = getTelemetryInstallDistinctId(stateDir)

      // then
      const path = join(stateDir, TELEMETRY_INSTALL_ID_FILE_NAME)
      const installId = readFileSync(path, "utf8").trim()
      expect(installId).toMatch(/^[0-9a-f]{64}$/)
      expect(first).toBe(createHash("sha256").update(installId).digest("hex"))
      expect(second).toBe(first)
      if (process.platform !== "win32") expect(statSync(path).mode & 0o777).toBe(0o600)
    })
  })

  test("#given a malformed id file #when the distinct id is read #then the file is repaired with a fresh id that later reads keep", () => {
    withStateDir((stateDir) => {
      // given
      getTelemetryInstallDistinctId(stateDir)
      writeFileSync(join(stateDir, TELEMETRY_INSTALL_ID_FILE_NAME), "not-an-id\n")

      // when
      const distinctId = getTelemetryInstallDistinctId(stateDir)

      // then
      const repaired = readFileSync(join(stateDir, TELEMETRY_INSTALL_ID_FILE_NAME), "utf8").trim()
      expect(repaired).toMatch(/^[0-9a-f]{64}$/)
      expect(distinctId).toBe(createHash("sha256").update(repaired).digest("hex"))
      expect(getTelemetryInstallDistinctId(stateDir)).toBe(distinctId)
    })
  })
})
