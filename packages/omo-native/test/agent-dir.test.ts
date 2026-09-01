import { afterEach, describe, expect, test } from "bun:test"
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import {
  ADOPTION_MARKER,
  adoptLegacyFlatState,
  canonicalAgentDir,
  legacyFlatAgentDir,
} from "../bin/lib/agent-dir.js"

const roots: string[] = []

function createHome(): string {
  const home = mkdtempSync(join(tmpdir(), "omo-agent-dir-"))
  roots.push(home)
  return home
}

function write(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, content)
}

function readJson(path: string): Record<string, unknown> {
  return JSON.parse(readFileSync(path, "utf8"))
}

const FLAT_SETTINGS = JSON.stringify({
  favoriteModels: ["anthropic/claude-fable-5"],
  retry: { fallbackChains: { "claude-fable-5": [] }, modelFallback: true },
}, null, 2)

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe("omo agent directory", () => {
  describe("#given no explicit override", () => {
    describe("#when the agent directory is resolved", () => {
      test("#then it is the canonical branded location", () => {
        const home = createHome()
        expect(canonicalAgentDir({}, home)).toBe(join(home, ".omo", "agent"))
      })
    })
  })

  describe("#given an explicit override", () => {
    describe("#when the agent directory is resolved", () => {
      test("#then the brand-prefixed name wins over the legacy names", () => {
        const home = createHome()
        const env = {
          OMO_CODING_AGENT_DIR: join(home, "brand"),
          SENPI_CODING_AGENT_DIR: join(home, "legacy"),
          PI_CODING_AGENT_DIR: join(home, "ancient"),
        }
        expect(canonicalAgentDir(env, home)).toBe(join(home, "brand"))
      })

      test("#then each legacy name is honored in order", () => {
        const home = createHome()
        expect(canonicalAgentDir({ SENPI_CODING_AGENT_DIR: join(home, "legacy") }, home)).toBe(join(home, "legacy"))
        expect(canonicalAgentDir({ PI_CODING_AGENT_DIR: join(home, "ancient") }, home)).toBe(join(home, "ancient"))
      })

      test("#then a blank value falls back to the canonical location", () => {
        const home = createHome()
        expect(canonicalAgentDir({ OMO_CODING_AGENT_DIR: "   " }, home)).toBe(join(home, ".omo", "agent"))
      })
    })
  })

  describe("#given a home whose only engine state sits in the legacy flat directory", () => {
    describe("#when the launcher adopts it", () => {
      test("#then the settings land in the canonical directory and the original is untouched", () => {
        const home = createHome()
        const flat = join(legacyFlatAgentDir(home), "settings.json")
        write(flat, FLAT_SETTINGS)
        write(join(legacyFlatAgentDir(home), "auth.json"), '{"anthropic":{"type":"api_key"}}')
        write(join(legacyFlatAgentDir(home), "logs", "session.log"), "noise\n")

        const result = adoptLegacyFlatState({}, home)

        const canonical = canonicalAgentDir({}, home)
        expect(result.adopted).toBe(true)
        expect(result.copied.sort()).toEqual(["auth.json", "settings.json"])
        expect(readJson(join(canonical, "settings.json"))).toEqual(JSON.parse(FLAT_SETTINGS))
        expect(readFileSync(flat, "utf8")).toBe(FLAT_SETTINGS)
        expect(existsSync(join(canonical, ADOPTION_MARKER))).toBe(true)
        expect(existsSync(join(canonical, "logs"))).toBe(false)
      })

      test("#then a second launch is a no-op and never resurrects removed state", () => {
        const home = createHome()
        write(join(legacyFlatAgentDir(home), "settings.json"), FLAT_SETTINGS)
        adoptLegacyFlatState({}, home)
        const canonical = canonicalAgentDir({}, home)
        writeFileSync(join(canonical, "settings.json"), JSON.stringify({ favoriteModels: [] }, null, 2))

        const second = adoptLegacyFlatState({}, home)

        expect(second.adopted).toBe(false)
        expect(readJson(join(canonical, "settings.json"))).toEqual({ favoriteModels: [] })
      })
    })
  })

  describe("#given canonical settings that lost keys the flat file still holds", () => {
    describe("#when the launcher adopts the legacy state", () => {
      test("#then only the missing keys are backfilled and nothing present is overwritten", () => {
        const home = createHome()
        write(join(legacyFlatAgentDir(home), "settings.json"), FLAT_SETTINGS)
        const canonical = canonicalAgentDir({}, home)
        write(join(canonical, "settings.json"), JSON.stringify({ favoriteModels: ["openai/gpt-5.6"] }, null, 2))

        const result = adoptLegacyFlatState({}, home)

        const merged = readJson(join(canonical, "settings.json"))
        expect(result.backfilled).toEqual(["retry"])
        expect(merged.favoriteModels).toEqual(["openai/gpt-5.6"])
        expect(merged.retry).toEqual(JSON.parse(FLAT_SETTINGS).retry)
        expect(readdirSync(canonical).some((entry) => entry.startsWith("settings.json.bak-"))).toBe(true)
      })
    })
  })

  describe("#given a home the adoption must not touch", () => {
    describe("#when the launcher runs", () => {
      test("#then an explicit override is respected and nothing is adopted", () => {
        const home = createHome()
        write(join(legacyFlatAgentDir(home), "settings.json"), FLAT_SETTINGS)
        const override = join(home, "elsewhere")

        const result = adoptLegacyFlatState({ OMO_CODING_AGENT_DIR: override }, home)

        expect(result.adopted).toBe(false)
        expect(existsSync(override)).toBe(false)
      })

      test("#then a home without legacy state stays empty", () => {
        const home = createHome()
        const result = adoptLegacyFlatState({}, home)
        expect(result.adopted).toBe(false)
        expect(existsSync(canonicalAgentDir({}, home))).toBe(false)
      })

      test("#then malformed legacy settings never break startup", () => {
        const home = createHome()
        write(join(legacyFlatAgentDir(home), "settings.json"), "{ not json")
        const canonical = canonicalAgentDir({}, home)
        write(join(canonical, "settings.json"), JSON.stringify({ favoriteModels: [] }, null, 2))

        const result = adoptLegacyFlatState({}, home)

        expect(result.backfilled).toEqual([])
        expect(readJson(join(canonical, "settings.json"))).toEqual({ favoriteModels: [] })
      })
    })
  })
})
