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

  describe("#given an existing canonical auth file that lacks a provider the flat file holds", () => {
    describe("#when the launcher adopts the legacy state", () => {
      test("#then the missing provider is merged in and the current provider survives", () => {
        // given
        const home = createHome()
        write(join(legacyFlatAgentDir(home), "auth.json"), JSON.stringify({
          "legacy-provider": { type: "oauth", access: "flat-only-value" },
        }, null, 2))
        const canonical = canonicalAgentDir({}, home)
        write(join(canonical, "auth.json"), JSON.stringify({
          "current-provider": { type: "oauth", access: "canonical-value" },
        }, null, 2))

        // when
        const result = adoptLegacyFlatState({}, home)

        // then
        const merged = readJson(join(canonical, "auth.json"))
        expect(result.backfilled).toContain("auth.json:legacy-provider")
        expect(merged["current-provider"]).toEqual({ type: "oauth", access: "canonical-value" })
        expect(merged["legacy-provider"]).toEqual({ type: "oauth", access: "flat-only-value" })
        expect(existsSync(join(canonical, ADOPTION_MARKER))).toBe(true)

        const second = adoptLegacyFlatState({}, home)
        expect(second.adopted).toBe(false)
        expect(readJson(join(canonical, "auth.json"))).toEqual(merged)
      })
    })
  })

  describe("#given existing canonical trust and model maps missing flat entries", () => {
    describe("#when the launcher adopts the legacy state", () => {
      test("#then every allowlisted map file is merged instead of skipped", () => {
        // given
        const home = createHome()
        const flatDir = legacyFlatAgentDir(home)
        write(join(flatDir, "trust.json"), JSON.stringify({ "/legacy/path": true }, null, 2))
        write(join(flatDir, "models.json"), JSON.stringify({ "legacy-gateway": { name: "legacy" } }, null, 2))
        write(join(flatDir, "models-store.json"), JSON.stringify({ ollama: { models: ["legacy"] } }, null, 2))
        write(join(flatDir, "mcp.json"), JSON.stringify({ "legacy-mcp": { url: "https://legacy.example" } }, null, 2))
        const canonical = canonicalAgentDir({}, home)
        write(join(canonical, "trust.json"), JSON.stringify({ "/current/path": true }, null, 2))
        write(join(canonical, "models.json"), JSON.stringify({ "current-gateway": { name: "current" } }, null, 2))
        write(join(canonical, "models-store.json"), JSON.stringify({ ollama: { models: ["current"] } }, null, 2))
        write(join(canonical, "mcp.json"), JSON.stringify({ "current-mcp": { url: "https://current.example" } }, null, 2))

        // when
        const result = adoptLegacyFlatState({}, home)

        // then
        expect(result.backfilled.sort()).toEqual([
          "mcp.json:legacy-mcp",
          "models.json:legacy-gateway",
          "trust.json:/legacy/path",
        ])
        expect(readJson(join(canonical, "trust.json"))).toEqual({ "/current/path": true, "/legacy/path": true })
        expect(readJson(join(canonical, "models.json"))).toEqual({
          "current-gateway": { name: "current" },
          "legacy-gateway": { name: "legacy" },
        })
        expect(readJson(join(canonical, "models-store.json"))).toEqual({ ollama: { models: ["current"] } })
        expect(readJson(join(canonical, "mcp.json"))).toEqual({
          "current-mcp": { url: "https://current.example" },
          "legacy-mcp": { url: "https://legacy.example" },
        })
        expect(existsSync(join(canonical, ADOPTION_MARKER))).toBe(true)
      })
    })
  })

  describe("#given canonical settings whose nested objects lost leaves the flat file still holds", () => {
    describe("#when the launcher adopts the legacy state", () => {
      test("#then missing nested properties are backfilled and present ones stay untouched", () => {
        // given
        const home = createHome()
        write(join(legacyFlatAgentDir(home), "settings.json"), JSON.stringify({
          favoriteModels: ["anthropic/claude-fable-5"],
          retry: { fallbackChains: { primary: [], secondary: [] }, modelFallback: true },
          tipsHistory: { firstRun: true, upgrade: true },
        }, null, 2))
        const canonical = canonicalAgentDir({}, home)
        write(join(canonical, "settings.json"), JSON.stringify({
          favoriteModels: ["openai/gpt-5.6"],
          retry: { fallbackChains: { primary: [] }, modelFallback: false },
        }, null, 2))

        // when
        const result = adoptLegacyFlatState({}, home)

        // then
        const merged = readJson(join(canonical, "settings.json"))
        expect(result.backfilled).toEqual(["retry", "tipsHistory"])
        expect(merged.favoriteModels).toEqual(["openai/gpt-5.6"])
        expect(merged.retry).toEqual({ fallbackChains: { primary: [], secondary: [] }, modelFallback: false })
        expect(merged.tipsHistory).toEqual({ firstRun: true, upgrade: true })
      })
    })
  })

  describe("#given a malformed legacy auth file beside an existing canonical auth file", () => {
    describe("#when the launcher adopts the legacy state", () => {
      test("#then startup survives, the canonical file is untouched, and the marker stays unwritten", () => {
        // given
        const home = createHome()
        write(join(legacyFlatAgentDir(home), "auth.json"), "{ not json")
        const canonical = canonicalAgentDir({}, home)
        const canonicalAuth = JSON.stringify({ "current-provider": { type: "oauth" } }, null, 2)
        write(join(canonical, "auth.json"), canonicalAuth)

        // when
        const result = adoptLegacyFlatState({}, home)

        // then
        expect(result.adopted).toBe(false)
        expect(readFileSync(join(canonical, "auth.json"), "utf8")).toBe(canonicalAuth)
        expect(existsSync(join(canonical, ADOPTION_MARKER))).toBe(false)
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
