import { afterEach, describe, expect, test } from "bun:test"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { ENGINE_PREPARED_STAMP, ensureEnginePrepared } from "../bin/lib/engine-prepare.js"

const PI_AI_MESSAGES = "node_modules/@earendil-works/pi-ai/dist/api/anthropic-messages.js"
const RPC_MODE = "dist/modes/rpc/rpc-mode.js"
const OMO_VERSION = "5.0.0-0.beta.86"
const REINSTALL = "npm i -g omo-ai@beta"

const roots: string[] = []

function uaSource(version: string): string {
  return `const claudeCodeVersion = "${version}";\nexport {}\n`
}

function createEngine(uaVersion: string): string {
  const root = mkdtempSync(join(tmpdir(), "omo-engine-prepare-"))
  roots.push(root)
  writeFileSync(join(root, "package.json"), JSON.stringify({ name: "@code-yeongyu/senpi", version: "2026.9.23", type: "module" }))
  const rpcPath = join(root, RPC_MODE)
  mkdirSync(dirname(rpcPath), { recursive: true })
  writeFileSync(rpcPath, readFileSync(new URL("./modes/rpc/rpc-mode.js", import.meta.resolve("@code-yeongyu/senpi")), "utf8"))
  const messages = join(root, PI_AI_MESSAGES)
  mkdirSync(dirname(messages), { recursive: true })
  writeFileSync(messages, uaSource(uaVersion))
  return root
}

function prepareOnce(root: string, reported: string[] = []) {
  ensureEnginePrepared({ senpiRoot: root, omoVersion: OMO_VERSION, reinstallCommand: REINSTALL, report: (line: string) => reported.push(line) })
}

const readUa = (root: string) => readFileSync(join(root, PI_AI_MESSAGES), "utf8")
const readStamp = (root: string) => readFileSync(join(root, ENGINE_PREPARED_STAMP), "utf8").trim()

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe("launcher engine preparation (#8713)", () => {
  describe("#given an engine that postinstall never prepared", () => {
    test("#then the launch prepares it and stamps it with the omo-ai version", () => {
      const root = createEngine("2.1.251")
      prepareOnce(root)
      expect(readUa(root)).toBe(uaSource("2.1.280"))
      expect(readFileSync(join(root, RPC_MODE), "utf8")).toContain("invalid_stream_event")
      expect(readStamp(root)).toBe(OMO_VERSION)
    })
  })

  describe("#given an engine already stamped for this omo-ai version", () => {
    test("#then the launch leaves every engine file untouched", () => {
      const root = createEngine("2.1.251")
      prepareOnce(root)
      writeFileSync(join(root, PI_AI_MESSAGES), uaSource("2.1.100"))
      prepareOnce(root)
      expect(readUa(root)).toBe(uaSource("2.1.100"))
    })
  })

  describe("#given an engine stamped by a different omo-ai version", () => {
    test("#then the launch prepares it again and restamps it", () => {
      const root = createEngine("2.1.251")
      writeFileSync(join(root, ENGINE_PREPARED_STAMP), "5.0.0-0.beta.85\n")
      prepareOnce(root)
      expect(readUa(root)).toBe(uaSource("2.1.280"))
      expect(readStamp(root)).toBe(OMO_VERSION)
    })
  })

  describe("#given an engine whose preparation fails", () => {
    test("#then the launch reports it with the reinstall command, does not throw, and leaves no stamp", () => {
      const root = createEngine("2.1.251")
      rmSync(join(root, RPC_MODE))
      const reported: string[] = []
      expect(() => prepareOnce(root, reported)).not.toThrow()
      expect(reported.join("")).toContain("rpc_patch_target_missing")
      expect(reported.join("")).toContain(REINSTALL)
      expect(existsSync(join(root, ENGINE_PREPARED_STAMP))).toBe(false)
    })
  })
})
