import { afterEach, describe, expect, test } from "bun:test"
import { Readable, Writable } from "node:stream"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"

import {
  applySetupStages,
  collectSetupPlans,
  scanSetup,
} from "../bin/lib/setup-stream.js"
import {
  buildPerServerConsent,
  filterPlansByConsent,
  loadSetupOptOut,
  perServerConsentPrompt,
  perServerPlan,
  resolvePerServerConsent,
  type ServerConsent,
} from "../bin/lib/setup-per-server.js"
import { teardownRoots } from "./teardown.test-support"

const SECRET_A = "SK-SENTINEL-PERSRV-A"
const SECRET_B = "SK-SENTINEL-PERSRV-B"
const FILE_SECRET = "/tmp/SENTINEL-FILE-SECRET-PATH"

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function write(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, content)
}

type Fixture = { home: string, agentDir: string, env: Record<string, string> }

function fixture(): Fixture {
  const root = mkdtempSync(join(tmpdir(), "omo-persrv-"))
  roots.push(root)
  const home = join(root, "home")
  write(join(home, ".local", "share", "opencode", "auth.json"), JSON.stringify({
    openai: { type: "api", key: SECRET_A },
    myco: { type: "api", key: SECRET_B },
  }))
  write(join(home, ".config", "opencode", "opencode.json"), JSON.stringify({
    model: "openai/gpt-5",
    mcp: {
      ctx: { type: "local", command: ["npx", "ctx"] },
      "flagged-shelly": { type: "remote", url: "https://shelly.example/mcp", headers: { Authorization: `Bearer ${SECRET_A}` } },
    },
    provider: { myco: { options: { baseURL: "https://example.invalid/v1" }, models: { m1: { name: "M1" } } } },
  }))
  write(join(home, ".config", "opencode", "skills", "my-skill", "SKILL.md"), "---\nname: my-skill\ndescription: d\n---\nbody\n")
  return { home, agentDir: join(home, ".omo", "agent"), env: { HOME: home } }
}

function catalogSpy() {
  const calls: number[] = []
  const loadModelCatalog = async () => {
    calls.push(Date.now())
    return [{ id: "openai", getModels: () => [{ id: "gpt-5" }] }]
  }
  return { calls, loadModelCatalog }
}

async function collect({ home, agentDir, env }: Fixture) {
  const { loadModelCatalog } = catalogSpy()
  const collected = await collectSetupPlans(scanSetup({ home, env, loadModelCatalog }, agentDir, { includeCustomProviders: true }))
  return collected
}

function readJson(path: string): Record<string, any> {
  return JSON.parse(require("node:fs").readFileSync(path, "utf8"))
}

describe("omo setup per-server consent (PR-D)", () => {
  describe("#given the setup stream has MCP servers and custom providers", () => {
    test("#when the per-server plan is built #then each row carries its kind, url and key sources", async () => {
      const fx = await fixture()
      const { plans } = await collect(fx)
      const optOut = await loadSetupOptOut({ home: fx.home, env: fx.env })
      const consent = buildPerServerConsent(plans, { optOut })

      const ids = consent.map((row) => row.id)
      expect(ids).toContain("ctx")
      expect(ids).toContain("flagged-shelly")
      expect(ids).toContain("myco")

      const shelly = consent.find((row) => row.id === "flagged-shelly")
      expect(shelly?.kind).toBe("mcp")
      expect(shelly?.url).toBe("https://shelly.example/mcp")
      // shelly's Authorization header is a literal Bearer token: no file refs to surface.
      expect(shelly?.fileRefs.length ?? 0).toBe(0)
      const myco = consent.find((row) => row.id === "myco")
      expect(myco?.kind).toBe("provider")
      expect(myco?.url).toBe("https://example.invalid/v1")
      expect((myco?.keys.length ?? 0)).toBeGreaterThan(0)
    })
  })

  describe("#given no opt-out config", () => {
    test("#when the per-server plan is built #then every server is awaiting consent", async () => {
      const fx = await fixture()
      const { plans } = await collect(fx)
      const consent = perServerPlan(plans).map((row) => ({ id: row.id, accept: row.accept, skippedReason: row.skippedReason }))
      expect(consent.every((row) => row.accept === null && row.skippedReason === undefined)).toBe(true)
    })
  })

  describe("#given an opt-out config that matches a server name", () => {
    test("#when the per-server plan is built #then the matching server is skipped with the opt-out reason", async () => {
      const root = mkdtempSync(join(tmpdir(), "omo-persrv-optout-"))
      roots.push(root)
      const home = join(root, "home")
      write(join(home, ".omo", "omo.jsonc"), JSON.stringify({ setup: { opt_out: { "flagged-shelly": true } } }))
      write(join(home, ".local", "share", "opencode", "auth.json"), JSON.stringify({ openai: { type: "api", key: SECRET_A } }))
      write(join(home, ".config", "opencode", "opencode.json"), JSON.stringify({
        model: "openai/gpt-5",
        mcp: {
          ctx: { type: "local", command: ["npx", "ctx"] },
          "flagged-shelly": { type: "remote", url: "https://shelly.example/mcp" },
        },
      }))
      const { plans } = await collect({ home, agentDir: join(home, ".omo", "agent"), env: { HOME: home } })
      const optOut = await loadSetupOptOut({ home, env: { HOME: home } })
      const consent = buildPerServerConsent(plans, { optOut }).map((row) => ({ id: row.id, accept: row.accept, skippedReason: row.skippedReason }))

      const shelly = consent.find((row) => row.id === "flagged-shelly")
      expect(shelly?.accept).toBe(false)
      expect(shelly?.skippedReason).toBe("opt-out:server")
      const ctx = consent.find((row) => row.id === "ctx")
      expect(ctx?.accept).toBeNull()
    })
  })

  describe("#given an opt-out config that matches by kind", () => {
    test("#when the per-server plan is built #then every provider is skipped with the opt-out reason", async () => {
      const root = mkdtempSync(join(tmpdir(), "omo-persrv-optout-kind-"))
      roots.push(root)
      const home = join(root, "home")
      write(join(home, ".omo", "omo.jsonc"), JSON.stringify({ setup: { opt_out: { kind: { provider: true } } } }))
      write(join(home, ".local", "share", "opencode", "auth.json"), JSON.stringify({ openai: { type: "api", key: SECRET_A } }))
      write(join(home, ".config", "opencode", "opencode.json"), JSON.stringify({
        model: "openai/gpt-5",
        mcp: { ctx: { type: "local", command: ["npx", "ctx"] } },
        provider: { myco: { options: { baseURL: "https://example.invalid/v1" }, models: { m1: { name: "M1" } } } },
      }))
      const { plans } = await collect({ home, agentDir: join(home, ".omo", "agent"), env: { HOME: home } })
      const optOut = await loadSetupOptOut({ home, env: { HOME: home } })
      const consent = buildPerServerConsent(plans, { optOut })

      const myco = consent.find((row) => row.id === "myco")
      expect(myco?.accept).toBe(false)
      expect(myco?.skippedReason).toBe("opt-out:kind")
      const ctx = consent.find((row) => row.id === "ctx")
      expect(ctx?.accept).toBeNull()
    })
  })

  describe("#given an opt-out config that matches by source glob", () => {
    test("#when the per-server plan is built #then a server whose file ref matches the glob is skipped", async () => {
      const root = mkdtempSync(join(tmpdir(), "omo-persrv-optout-source-"))
      roots.push(root)
      const home = join(root, "home")
      write(join(home, ".omo", "omo.jsonc"), JSON.stringify({ setup: { opt_out: { source: { [`${FILE_SECRET}*`]: true } } } }))
      const optOut = await loadSetupOptOut({ home, env: { HOME: home } })

      // Until PR-A lands, `{file:...}` placeholders are refused by `setup-opencode-assets.js`
      // before reaching the per-server consent layer. The consent's source-glob stage is exercised
      // here with a synthetic plan shaped like the post-PR-A one: the file ref is the canonical
      // path the resolveFileRef integration will hand in.
      const consent = buildPerServerConsent(
        {
          providers: { result: { added: [], keys: [] } },
          assets: {
            result: {
              servers: {
                added: [
                  { name: "shelly", config: { type: "http", url: "https://shelly.example/mcp", headers: { "X-Token": `{file:${FILE_SECRET}}` } } },
                ],
              },
            },
          },
        },
        { optOut },
      )

      const shelly = consent.find((row) => row.id === "shelly")
      expect(shelly?.accept).toBe(false)
      expect(shelly?.skippedReason).toBe("opt-out:source")
      expect(shelly?.fileRefs.some((ref) => ref.includes(FILE_SECRET))).toBe(true)
    })
  })

  describe("#given the interactive prompt is rendered for a server with a file ref", () => {
    test("#when the format renders #then it carries name, kind, url and the file ref", () => {
      const line = perServerConsentPrompt({
        id: "shelly",
        kind: "mcp",
        url: "https://shelly.example/mcp",
        fileRefs: [FILE_SECRET],
        keys: [],
        accept: null,
      })
      expect(line).toContain("shelly")
      expect(line).toContain("mcp")
      expect(line).toContain("https://shelly.example/mcp")
      // The placeholder body is the safe form an opt-out consumer should see until PR-A wires
      // resolveFileRef into the per-server consent layer.
      expect(line).toContain(FILE_SECRET)
      expect(line).toContain("[Y/n]")
    })
  })

  describe("#given the user types Y/n in an interactive session", () => {
    test("#when consent is asked per server #then exactly the accepted servers are imported", async () => {
      const fx = await fixture()
      const { plans } = await collect(fx)
      const optOut = await loadSetupOptOut({ home: fx.home, env: fx.env })
      const consent = buildPerServerConsent(plans, { optOut })

      const decisions = new Map<string, boolean>()
      for (const row of consent) decisions.set(row.id, row.id === "ctx" || row.id === "myco")

      const filtered = filterPlansByConsent(plans, decisions)
      await applySetupStages(filtered, () => true, () => {}, { yes: true })

      const models = readJson(join(fx.agentDir, "models.json")) as { providers: Record<string, unknown> }
      const mcp = readJson(join(fx.agentDir, "mcp.json")) as { mcpServers: Record<string, unknown> }
      expect(Object.keys(models.providers).sort()).toEqual(["myco"])
      expect(Object.keys(mcp.mcpServers).sort()).toEqual(["ctx"])
    })

    test("#when consent is declined for every server #then no MCP server or custom provider lands", async () => {
      const fx = await fixture()
      const { plans } = await collect(fx)
      const decisions = new Map<string, boolean>()
      for (const row of buildPerServerConsent(plans)) decisions.set(row.id, false)

      const filtered = filterPlansByConsent(plans, decisions)
      await applySetupStages(filtered, () => true, () => {})

      // The credentials stage is independent of the per-server consent: it imports API keys from
      // opencode's auth.json (here, openai) regardless of MCP/provider consent.
      expect(require("node:fs").existsSync(join(fx.agentDir, "models.json"))).toBe(false)
      expect(require("node:fs").existsSync(join(fx.agentDir, "mcp.json"))).toBe(false)
    })
  })

  describe("#given resolvePerServerConsent with prompt decisions", () => {
    test("#when the user accepts only one of three servers #then only that one is true", async () => {
      const fx = await fixture()
      const { plans } = await collect(fx)
      const optOut = await loadSetupOptOut({ home: fx.home, env: fx.env })
      const consent = buildPerServerConsent(plans, { optOut })

      const askedFor: string[] = []
      const decisions = await resolvePerServerConsent(consent, async (row) => {
        askedFor.push(row.id)
        return row.id === "myco"
      })
      expect(askedFor.length).toBe(consent.length)
      expect(askedFor.every((id) => consent.some((row) => row.id === id))).toBe(true)
      expect(decisions.get("myco")).toBe(true)
      expect(decisions.get("ctx")).toBe(false)
      expect(decisions.get("flagged-shelly")).toBe(false)
    })

    test("#when every server is opted out via config #then no prompt is asked and decisions reflect the opt-outs", async () => {
      const root = mkdtempSync(join(tmpdir(), "omo-persrv-allopt-"))
      roots.push(root)
      const home = join(root, "home")
      write(join(home, ".omo", "omo.jsonc"), JSON.stringify({ setup: { opt_out: { kind: { mcp: true, provider: true } } } }))
      write(join(home, ".local", "share", "opencode", "auth.json"), JSON.stringify({ openai: { type: "api", key: SECRET_A } }))
      write(join(home, ".config", "opencode", "opencode.json"), JSON.stringify({
        model: "openai/gpt-5",
        mcp: { ctx: { type: "local", command: ["npx", "ctx"] } },
        provider: { myco: { options: { baseURL: "https://example.invalid/v1" }, models: { m1: { name: "M1" } } } },
      }))
      const { plans } = await collect({ home, agentDir: join(home, ".omo", "agent"), env: { HOME: home } })
      const optOut = await loadSetupOptOut({ home, env: { HOME: home } })
      const consent = buildPerServerConsent(plans, { optOut })

      let prompts = 0
      const decisions = await resolvePerServerConsent(consent, async () => { prompts += 1; return true })

      expect(prompts).toBe(0)
      expect(decisions.get("ctx")).toBe(false)
      expect(decisions.get("myco")).toBe(false)
    })
  })

  describe("#given the dry-run path", () => {
    test("#when the per-server plan is rendered #then every server is listed with full provenance and nothing is written", async () => {
      const fx = await fixture()
      const { plans } = await collect(fx)
      const optOut = await loadSetupOptOut({ home: fx.home, env: fx.env })
      const consent = buildPerServerConsent(plans, { optOut })
      const rendered = consent.map((row) => perServerConsentPrompt(row)).join("\n")

      expect(rendered).toContain("ctx")
      expect(rendered).toContain("myco")
      expect(rendered).toContain("flagged-shelly")
      expect(consent.length).toBeGreaterThanOrEqual(3)
      expect(require("node:fs").existsSync(join(fx.agentDir, "models.json"))).toBe(false)
      expect(require("node:fs").existsSync(join(fx.agentDir, "mcp.json"))).toBe(false)
    })
  })

  describe("#given --yes (legacy batch behavior)", () => {
    test("#when apply is called with --yes and no opt-out #then every server is imported exactly as before", async () => {
      const fx = await fixture()
      const { plans } = await collect(fx)
      await applySetupStages(plans, () => true, () => {})

      const models = readJson(join(fx.agentDir, "models.json")) as { providers: Record<string, unknown> }
      const mcp = readJson(join(fx.agentDir, "mcp.json")) as { mcpServers: Record<string, unknown> }
      expect(Object.keys(models.providers).sort()).toEqual(["myco"])
      expect(Object.keys(mcp.mcpServers).sort()).toEqual(["ctx", "flagged-shelly"])
    })

    test("#when apply is called with opt-out but no consent flow #then the named server is skipped", async () => {
      const root = mkdtempSync(join(tmpdir(), "omo-persrv-yes-"))
      roots.push(root)
      const home = join(root, "home")
      write(join(home, ".omo", "omo.jsonc"), JSON.stringify({ setup: { opt_out: { "flagged-shelly": true } } }))
      write(join(home, ".local", "share", "opencode", "auth.json"), JSON.stringify({ openai: { type: "api", key: SECRET_A } }))
      write(join(home, ".config", "opencode", "opencode.json"), JSON.stringify({
        model: "openai/gpt-5",
        mcp: {
          ctx: { type: "local", command: ["npx", "ctx"] },
          "flagged-shelly": { type: "remote", url: "https://shelly.example/mcp" },
        },
      }))
      const { plans } = await collect({ home, agentDir: join(home, ".omo", "agent"), env: { HOME: home } })
      const optOut = await loadSetupOptOut({ home, env: { HOME: home } })
      const consent = buildPerServerConsent(plans, { optOut })
      const filtered = filterPlansByConsent(plans, new Map(consent.map((row) => [row.id, row.accept !== false])))

      await applySetupStages(filtered, () => true, () => {})
      const mcpPath = join(home, ".omo", "agent", "mcp.json")
      const mcp = require("node:fs").existsSync(mcpPath)
        ? readJson(mcpPath) as { mcpServers: Record<string, unknown> }
        : { mcpServers: {} }
      expect(Object.keys(mcp.mcpServers).sort()).toEqual(["ctx"])
    })
  })

  describe("#given loadSetupOptOut runs without a config file", () => {
    test("#when there is no omo.jsonc #then the opt-out is the empty default", async () => {
      const fx = await fixture()
      const optOut = await loadSetupOptOut({ home: fx.home, env: fx.env })
      expect(optOut.byName.size).toBe(0)
      expect(optOut.byKind.size).toBe(0)
      expect(optOut.bySource.length).toBe(0)
    })
  })
})
