import { describe, expect, test } from "bun:test"
import { spawnSync } from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { createScrubbedEnvironment, observeChildXSearchCall, resolveSenpiBin, scenarioTarget, seedXaiCredential, senpiVersion, shredSeededCredential, skillHasX } from "./x-search-live-e2e.mjs"

describe("x-search live QA isolation helpers", () => {
  test("resolves SENPI_BIN, then the peer dependency, then PATH", () => {
    const root = mkdtempSync(join(tmpdir(), "omo-x-search-bin-test-"))
    const win32 = process.platform === "win32"
    const shim = win32 ? "senpi.cmd" : "senpi"
    const requested = join(root, win32 ? "requested-senpi.cmd" : "requested-senpi")
    const peer = join(root, "node_modules", ".bin", shim)
    const pathDir = join(root, "path")
    mkdirSync(join(root, "node_modules", ".bin"), { recursive: true })
    mkdirSync(pathDir, { recursive: true })
    const body = win32 ? "@echo 2026.9.2-4\n" : "#!/bin/sh\nprintf '2026.9.2-4\\n'\n"
    for (const path of [requested, peer, join(pathDir, shim)]) writeFileSync(path, body, { mode: 0o755 })
    try {
      expect(resolveSenpiBin({ root, cwd: root, env: { SENPI_BIN: requested, PATH: pathDir } })).toEqual({ path: requested, source: "SENPI_BIN" })
      rmSync(requested)
      expect(resolveSenpiBin({ root, cwd: root, env: { SENPI_BIN: requested, PATH: pathDir } })).toEqual({ path: peer, source: "peer-dependency" })
      rmSync(peer)
      expect(resolveSenpiBin({ root, cwd: root, env: { SENPI_BIN: requested, PATH: pathDir } })).toEqual({ path: join(pathDir, shim), source: "PATH", warning: expect.any(String) })
      expect(senpiVersion(join(pathDir, shim))).toBe("2026.9.2-4")
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
  test("uses the observed child x_search execution outcome", () => {
    const denied = observeChildXSearchCall(JSON.stringify({ type: "tool_execution", payload: { tool: "x_search", is_error: true } }))
    expect(denied).toEqual({ observed: true, source: "child-tool-execution", isError: true, outcome: "denied" })
    const fabricatedSuccess = observeChildXSearchCall(JSON.stringify({ type: "tool_execution", payload: { tool: "x_search", is_error: false } }))
    expect(fabricatedSuccess.outcome).toBe("success")
    expect(fabricatedSuccess.outcome).not.toBe("denied")
    expect(observeChildXSearchCall("assistant said unavailable").observed).toBe(false)
  })
  test("detects x_search in a tool execution transcript", () => {
    expect(skillHasX('{"toolName":"x_search"}')).toBe(true)
  })

  test("maps each live scenario to its intended task target", () => {
    expect(scenarioTarget("explore")).toEqual({ subagent_type: "explore" })
    expect(scenarioTarget("librarian")).toEqual({ subagent_type: "librarian" })
    expect(scenarioTarget("quick")).toEqual({ category: "quick" })
  })

  test("keeps the negative catalog control query distinct from X posts", () => {
    const script = readFileSync(join(import.meta.dir, "x-search-live-e2e.mjs"), "utf8")
    expect(script).toContain('query: "X posts"')
    expect(script).toContain('query: NEGATIVE_CONTROL_QUERY')
    expect(script).toContain('name: "x_probe_tool"')
  })

  test("scrubs XAI and GROK variables from the environment passed to a spawned process", () => {
    const { env, scrubbed } = createScrubbedEnvironment({
      PATH: process.env.PATH,
      SAFE_VALUE: "kept",
      XAI_API_KEY: "must-not-reach-child",
      XAI_OTHER: "must-not-reach-child",
      GROK_TOKEN: "must-not-reach-child",
    })
    const child = spawnSync(process.execPath, ["-e", "process.stdout.write(JSON.stringify({safe:process.env.SAFE_VALUE,xai:process.env.XAI_API_KEY,grok:process.env.GROK_TOKEN}))"], { env, encoding: "utf8" })
    expect(child.status).toBe(0)
    expect(JSON.parse(child.stdout)).toEqual({ safe: "kept" })
    expect(scrubbed).toEqual(["GROK_TOKEN", "XAI_API_KEY", "XAI_OTHER"])
  })

  test("copies only the xai credential into the sandbox and removes the seeded file", () => {
    const root = mkdtempSync(join(tmpdir(), "omo-x-search-live-qa-test-"))
    const sourceAgentDir = join(root, "home", ".omo", "agent")
    const targetAgentDir = join(root, "sandbox", "agent")
    mkdirSync(sourceAgentDir, { recursive: true })
    mkdirSync(targetAgentDir, { recursive: true })
    writeFileSync(join(sourceAgentDir, "auth.json"), JSON.stringify({ xai: { type: "oauth", access: "access-secret", refresh: "refresh-secret", expires: 9999999999999 }, anthropic: { type: "oauth", access: "must-not-copy" } }))
    try {
      const receipt = seedXaiCredential({ sourceAgentDir, targetAgentDir })
      const seeded = JSON.parse(readFileSync(receipt.path, "utf8"))
      expect(Object.keys(seeded)).toEqual(["xai"])
      expect(seeded.xai.type).toBe("oauth")
      expect(receipt.seeded).toBe(true)
      const cleanup = shredSeededCredential(receipt.path)
      expect(cleanup.removed).toBe(true)
      expect(cleanup.overwrittenBytes).toBeGreaterThan(0)
      expect(existsSync(receipt.path)).toBe(false)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
