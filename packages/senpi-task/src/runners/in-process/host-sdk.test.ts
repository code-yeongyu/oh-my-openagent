import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, test } from "bun:test"

import { createChildSessionFromHostSdk, resolveHostSenpiSdkEntry } from "./host-sdk"

describe("host Senpi SDK", () => {
  test("#given a symlinked Senpi CLI #when resolving its SDK #then the sibling host index is selected", () => {
    const root = mkdtempSync(join(tmpdir(), "senpi-host-sdk-"))
    const dist = join(root, "package", "dist")
    const bin = join(root, "bin")
    mkdirSync(dist, { recursive: true })
    mkdirSync(bin, { recursive: true })
    writeFileSync(join(dist, "cli.js"), "")
    writeFileSync(join(dist, "index.js"), "")
    const executable = join(bin, "senpi")
    symlinkSync(join(dist, "cli.js"), executable)

    try {
      expect(resolveHostSenpiSdkEntry(executable)).toBe(join(dist, "index.js"))
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test("#given a host SDK module #when creating a child #then that module constructs the session", async () => {
    const root = mkdtempSync(join(tmpdir(), "senpi-host-session-"))
    const sdkEntry = join(root, "index.js")
    writeFileSync(join(root, "package.json"), '{"type":"module"}\n')
    writeFileSync(sdkEntry, [
      "export async function createAgentSession(options) {",
      "  const noop = async () => {}",
      "  return { session: { sessionId: options.cwd, prompt: noop, steer: noop, followUp: noop, abort: noop, subscribe: () => () => {}, getLastAssistantText: () => undefined, dispose: () => {} } }",
      "}",
    ].join("\n"))

    try {
      const session = await createChildSessionFromHostSdk(sdkEntry, { cwd: "host-session" })
      expect(session.sessionId).toBe("host-session")
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
