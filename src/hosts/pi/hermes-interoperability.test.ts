import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { isPiHermesMemoryEnabled, resolvePiHermesOwnedToolNames } from "./hermes-interoperability"

let root: string
let agentDir: string
let cwd: string

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "omo-pi-hermes-"))
  agentDir = join(root, "agent")
  cwd = join(root, "project")
  mkdirSync(join(agentDir, "npm", "node_modules", "pi-hermes-memory"), { recursive: true })
  mkdirSync(join(cwd, ".pi"), { recursive: true })
  writeFileSync(join(agentDir, "npm", "node_modules", "pi-hermes-memory", "package.json"), "{}")
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

describe("Pi Hermes interoperability", () => {
  test("#given Hermes configured and installed #when resolving tool ownership #then Hermes owns canonical skill and session search", () => {
    writeFileSync(join(agentDir, "settings.json"), JSON.stringify({ packages: ["npm:pi-hermes-memory"] }))

    expect(isPiHermesMemoryEnabled({ agentDir, cwd })).toBe(true)
    expect(resolvePiHermesOwnedToolNames({ agentDir, cwd })).toEqual(["skill", "session_search"])
  })

  test("#given Hermes installed but not configured #when resolving tool ownership #then OMO keeps its tools", () => {
    writeFileSync(join(agentDir, "settings.json"), JSON.stringify({ packages: ["npm:another-extension"] }))

    expect(isPiHermesMemoryEnabled({ agentDir, cwd })).toBe(false)
    expect(resolvePiHermesOwnedToolNames({ agentDir, cwd })).toEqual([])
  })

  test("#given project settings configure Hermes #when resolving tool ownership #then project configuration is honored", () => {
    writeFileSync(join(cwd, ".pi", "settings.json"), JSON.stringify({ packages: [{ source: "npm:pi-hermes-memory" }] }))

    expect(resolvePiHermesOwnedToolNames({ agentDir, cwd })).toEqual(["skill", "session_search"])
  })
})
