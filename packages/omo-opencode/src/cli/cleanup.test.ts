import { describe, expect, test, spyOn, afterEach } from "bun:test"
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { cleanup } from "./cleanup"

const logCalls: string[] = []
let logSpy: ReturnType<typeof spyOn> | undefined

afterEach(() => {
  logSpy?.mockRestore()
  logSpy = undefined
  logCalls.length = 0
})

function captureConsoleLog(): void {
  logSpy = spyOn(console, "log").mockImplementation((...args: unknown[]) => {
    logCalls.push(args.map(String).join(" "))
  })
}

function writeLeftoverAgent(root: string, relativeDir: string[], fileName: string): string {
  const dir = join(root, ...relativeDir)
  mkdirSync(dir, { recursive: true })
  const filePath = join(dir, fileName)
  writeFileSync(filePath, "---\nmode: primary\n---\n")
  return filePath
}

describe("#cleanup", () => {
  describe("#given platform opencode with leftover omo agent definitions", () => {
    test("#then removes them and exits 0", async () => {
      captureConsoleLog()
      const configDir = mkdtempSync(join(tmpdir(), "omo-cleanup-config-"))
      const project = mkdtempSync(join(tmpdir(), "omo-cleanup-project-"))
      const sisyphus = writeLeftoverAgent(configDir, ["agent"], "sisyphus.md")
      const atlas = writeLeftoverAgent(project, [".opencode", "agent"], "atlas.md")

      const exitCode = await cleanup({ platform: "opencode", configDir, project })

      expect(exitCode).toBe(0)
      expect(logCalls.some((line) => line.includes(sisyphus))).toBe(true)
      expect(logCalls.some((line) => line.includes(atlas))).toBe(true)
    })
  })

  describe("#given no explicit platform on the opencode CLI", () => {
    test("#then defaults to the opencode cleanup instead of erroring", async () => {
      captureConsoleLog()
      const configDir = mkdtempSync(join(tmpdir(), "omo-cleanup-default-"))
      const prometheus = writeLeftoverAgent(configDir, ["agents"], "prometheus.md")

      const exitCode = await cleanup({ configDir })

      expect(exitCode).toBe(0)
      expect(logCalls.some((line) => line.includes(prometheus))).toBe(true)
    })
  })

  describe("#given json output requested", () => {
    test("#then prints a structured result including removed paths", async () => {
      captureConsoleLog()
      const configDir = mkdtempSync(join(tmpdir(), "omo-cleanup-json-"))
      const hephaestus = writeLeftoverAgent(configDir, ["agent"], "hephaestus.md")

      const exitCode = await cleanup({ platform: "opencode", configDir, json: true })

      expect(exitCode).toBe(0)
      const payload = JSON.parse(logCalls.join("\n")) as { platform: string; removedPaths: string[] }
      expect(payload.platform).toBe("opencode")
      expect(payload.removedPaths).toEqual([hephaestus])
    })
  })
})
