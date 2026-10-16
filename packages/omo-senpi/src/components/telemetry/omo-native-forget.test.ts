import { afterEach, describe, expect, test } from "bun:test"
import { createHash } from "node:crypto"
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import type { TelemetryOsProvider } from "@oh-my-opencode/telemetry-core"

import { forgetOmoNativeInstall } from "./omo-native-forget"

const INSTALL_ID = "b".repeat(64)
const servers: ReturnType<typeof Bun.serve>[] = []
const roots: string[] = []

afterEach(() => {
  for (const server of servers.splice(0)) server.stop(true)
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function osWithHostname(hostname: string | Error): TelemetryOsProvider {
  return {
    arch: () => "arm64",
    cpus: () => [],
    hostname: () => {
      if (hostname instanceof Error) throw hostname
      return hostname
    },
    platform: () => "darwin",
    release: () => "25.3.0",
    totalmem: () => 0,
    type: () => "Darwin",
  }
}

function startCollector() {
  const bodies: unknown[] = []
  const server = Bun.serve({
    port: 0,
    async fetch(request) {
      bodies.push(await request.json())
      return Response.json({ status: "scheduled" }, { status: 202 })
    },
  })
  servers.push(server)
  return { bodies, env: { OMO_TELEMETRY_ENDPOINT: `http://127.0.0.1:${server.port}` } }
}

function stateDir(installId?: string): string {
  const root = mkdtempSync(join(tmpdir(), "omo-forget-"))
  roots.push(root)
  if (installId !== undefined) writeFileSync(join(root, "install-id"), `${installId}\n`)
  return root
}

describe("forgetOmoNativeInstall", () => {
  test("#given an install #when forgetting #then legacy_distinct_id is the PostHog distinct id this client sent", async () => {
    const collector = startCollector()

    const result = await forgetOmoNativeInstall({
      env: collector.env,
      osProvider: osWithHostname("test-host"),
      stateDir: stateDir(INSTALL_ID),
    })

    const posthogDistinctId = createHash("sha256").update("omo-senpi:test-host").digest("hex")
    expect(collector.bodies).toEqual([{ install_id: INSTALL_ID, legacy_distinct_id: posthogDistinctId }])
    expect(result.status).toBe("sent")
  })

  test("#given no hostname to derive a PostHog distinct id from #when forgetting #then legacy_distinct_id is absent", async () => {
    const collector = startCollector()

    await forgetOmoNativeInstall({
      env: collector.env,
      osProvider: osWithHostname(new Error("hostname unavailable")),
      stateDir: stateDir(INSTALL_ID),
    })

    expect(collector.bodies).toEqual([{ install_id: INSTALL_ID }])
  })

  test("#given an install that never created an install id #when forgetting #then nothing is sent and no id is created", async () => {
    const collector = startCollector()
    const dir = stateDir()

    const result = await forgetOmoNativeInstall({ env: collector.env, osProvider: osWithHostname("test-host"), stateDir: dir })

    expect(result).toEqual({ status: "skipped", reason: "no_install_id" })
    expect(collector.bodies).toEqual([])
    expect(existsSync(join(dir, "install-id"))).toBe(false)
  })

  test("#given a Desktop-pinned install id #when forgetting #then the pinned id is the one forgotten", async () => {
    const collector = startCollector()
    const pinned = "c".repeat(64)

    await forgetOmoNativeInstall({
      env: { ...collector.env, OMO_NATIVE_INSTALL_ID: pinned },
      osProvider: osWithHostname("test-host"),
      stateDir: stateDir(INSTALL_ID),
    })

    expect(collector.bodies.map((body) => (body as { install_id: string }).install_id)).toEqual([pinned])
  })
})
