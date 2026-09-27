import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, readdirSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import {
  categoryCoverage,
  coverageSummaryParts,
  doctorCoverageLines,
  engineAvailableModels,
  formatDoctorCoverageLines,
  setupCoverage,
} from "../bin/lib/category-coverage.js"
import { runDoctor } from "../bin/lib/doctor.js"
import { runSetup } from "../bin/lib/setup-import.js"
import { formatSetupSummary } from "../bin/lib/setup-summary.js"
import { teardownRoots } from "./teardown.test-support"

// The real engine (the pinned senpi this package resolves) and the real resolver entry the build
// bundles; only the agent dir and HOME are fixtures.
const loadRuntime = () => import("../category-coverage-entry")
const roots: string[] = []
afterEach(() => teardownRoots(roots))

// The engine also counts provider env keys; this suite's registries must be exactly its fixtures.
const CREDENTIAL_ENV = /(API_KEY|_TOKEN|_KEY$|^AWS_|^GOOGLE_|^VERTEX|^AZURE_)/
const savedEnv: Record<string, string> = {}
beforeAll(() => {
  for (const [name, value] of Object.entries(process.env)) {
    if (CREDENTIAL_ENV.test(name) && value !== undefined) {
      savedEnv[name] = value
      delete process.env[name]
    }
  }
})
afterAll(() => Object.assign(process.env, savedEnv))

function sandbox(auth?: Record<string, unknown>): { home: string, agentDir: string } {
  const home = mkdtempSync(join(tmpdir(), "omo-category-coverage-"))
  roots.push(home)
  const agentDir = join(home, ".omo", "agent")
  mkdirSync(agentDir, { recursive: true })
  if (auth !== undefined) writeFileSync(join(agentDir, "auth.json"), JSON.stringify(auth))
  return { home, agentDir }
}

async function coverageFor(provider: string) {
  const { home, agentDir } = sandbox({ [provider]: { type: "api_key", key: "dummy" } })
  const models = await engineAvailableModels({ agentDir, cwd: home })
  const coverage = await categoryCoverage({ models, cwd: home, env: { HOME: home }, loadRuntime })
  return { models, coverage, agentDir }
}

async function captureStdout(run: () => Promise<void>): Promise<string> {
  const chunks: string[] = []
  const original = process.stdout.write
  process.stdout.write = ((chunk: string | Uint8Array) => { chunks.push(String(chunk)); return true }) as typeof process.stdout.write
  try {
    await run()
  } finally {
    process.stdout.write = original
  }
  return chunks.join("")
}

function setupPlans(input: { additions: { provider: string, key: string }[], added: unknown[], pinned: string[] }) {
  return {
    credentials: { current: { entries: {} }, result: { additions: input.additions } },
    providers: { models: { document: { providers: {} } }, result: { added: input.added, keys: [] } },
    modelChoices: { items: input.pinned.map((name) => ({ kind: "categories", name, state: "pending" })) },
  }
}

describe("category coverage from the engine's model list", () => {
  describe("#given an agent dir whose only credential is a zai key", () => {
    test("#when coverage is computed #then only unspecified-high is usable and nothing is written", async () => {
      const { models, coverage, agentDir } = await coverageFor("zai")

      expect([...new Set(models.map((model) => model.provider))]).toEqual(["zai"])
      expect(coverage.usable).toEqual(["unspecified-high"])
      expect(coverage.unusable.map((gap) => gap.name)).toEqual([
        "architect", "artistry", "deep-high", "deep-low", "quick", "ultrabrain", "unspecified-low", "visual-engineering", "writing",
      ])
      expect(readdirSync(agentDir)).toEqual(["auth.json"])
    })
  })

  describe("#given an agent dir whose only credential is an anthropic key", () => {
    test("#when coverage is computed #then seven categories are usable and the GPT lanes name the GPT providers", async () => {
      const { coverage } = await coverageFor("anthropic")

      expect(coverage.usable).toEqual(["architect", "artistry", "quick", "unspecified-high", "unspecified-low", "visual-engineering", "writing"])
      expect(coverage.unusable.map((gap) => gap.name)).toEqual(["deep-high", "deep-low", "ultrabrain"])
      expect(coverage.unusable.every((gap) => gap.providers.includes("openai"))).toBe(true)
    })
  })

  describe("#given no stored credential and a CLAUDE_CODE_OAUTH_TOKEN in the environment", () => {
    test("#when the model list is built #then the engine's own anthropic-subscription check serves the Claude categories", async () => {
      const { home, agentDir } = sandbox()
      process.env.CLAUDE_CODE_OAUTH_TOKEN = "dummy"
      try {
        const models = await engineAvailableModels({ agentDir, cwd: home })
        const coverage = await categoryCoverage({ models, cwd: home, env: { HOME: home }, loadRuntime })

        expect([...new Set(models.map((model) => model.provider))]).toEqual(["anthropic-subscription"])
        expect(coverage.usable).toContain("architect")
        expect(readdirSync(agentDir)).toEqual([])
      } finally {
        delete process.env.CLAUDE_CODE_OAUTH_TOKEN
      }
    })
  })

  describe("#given an anthropic-subscription entry the engine does not accept as a subscription login", () => {
    test("#when the model list is built #then anthropic-subscription is not counted", async () => {
      const { models } = await coverageFor("anthropic-subscription")

      expect(models).toEqual([])
    })
  })

  describe("#given a setup plan that imports a zai key, a custom provider and a category pin", () => {
    test("#when setup coverage is computed #then the planned credentials, provider and pin all count and nothing is written", async () => {
      const { home, agentDir } = sandbox()
      const acme = { id: "acme", config: { baseUrl: "https://api.acme.example/v1", api: "openai-completions", apiKey: "acme-key", models: [{ id: "claude-fable-5-1" }] } }

      const coverage = await setupCoverage({
        agentDir,
        home,
        env: {},
        cwd: home,
        plans: setupPlans({ additions: [{ provider: "zai", key: "dummy" }], added: [acme], pinned: ["quick"] }),
        loadRuntime,
      })

      // acme serves only claude-fable-5-1, which is not a writing rung
      expect(coverage?.usable).toEqual(["architect", "artistry", "quick", "unspecified-high", "visual-engineering"])
      expect(readdirSync(agentDir)).toEqual([])
    })
  })
})

describe("category coverage reaches the commands", () => {
  describe("#given coverage lines from the launcher", () => {
    test("#when doctor runs #then it prints them", () => {
      const { home } = sandbox()
      const output: string[] = []
      const originalLog = console.log
      const originalExitCode = process.exitCode
      console.log = (value?: unknown) => { output.push(String(value)) }
      try {
        runDoctor({ harnesses: [] }, [], {
          list: () => [],
          env: { HOME: home },
          fetchDistTags: () => ({ beta: "0.0.0-test" }),
          categoryCoverage: ["WARN task categories: SENTINEL"],
        })
      } finally {
        console.log = originalLog
        process.exitCode = originalExitCode ?? 0
      }
      expect(output.join("\n").split("\n")).toContain("WARN task categories: SENTINEL")
    })
  })

  describe("#given an OpenCode login with only a Z.AI key", () => {
    test("#when omo setup --dry-run runs #then its summary carries the categories row and nothing is written", async () => {
      const { home, agentDir } = sandbox()
      mkdirSync(join(home, ".local", "share", "opencode"), { recursive: true })
      writeFileSync(join(home, ".local", "share", "opencode", "auth.json"), JSON.stringify({ "zai-coding-plan": { type: "api", key: "dummy" } }))

      const stdout = await captureStdout(() => runSetup(["--dry-run"], { home, env: { HOME: home }, loadCoverageRuntime: loadRuntime }))

      const rows = stdout.split("\n").filter((line) => /^ {2}\S/.test(line)).map((line) => line.slice(2, 16).trim())
      expect(rows).toContain("categories")
      expect(readdirSync(agentDir)).toEqual([])
    })
  })
})

describe("category coverage fails open", () => {
  describe("#given an engine that cannot be loaded", () => {
    test("#when doctor asks for coverage lines #then it gets none", async () => {
      const lines = await doctorCoverageLines({ agentDir: sandbox().agentDir, loadEngine: () => Promise.reject(new Error("engine missing")) })
      expect(lines).toEqual([])
    })
  })

  describe("#given a payload without the coverage runtime", () => {
    test("#when setup asks for coverage #then it gets undefined and the summary has no categories row", async () => {
      const { home, agentDir } = sandbox()
      const coverage = await setupCoverage({
        agentDir, home, env: {}, cwd: home,
        plans: setupPlans({ additions: [], added: [], pinned: [] }),
        loadRuntime: () => Promise.reject(new Error("runtime missing")),
      })
      expect(coverage).toBeUndefined()
      expect(summaryRowLabels(coverage)).not.toContain("categories")
    })
  })
})

function summaryRowLabels(categories: unknown): string[] {
  const summary = formatSetupSummary({
    home: "/h",
    agentDir: "/h/.omo/agent",
    inventory: { harnesses: [] },
    credentials: { notices: [], result: { additions: [], skippedExisting: [] }, guidance: { logins: [], unmapped: [] } },
    assets: {
      notices: [], present: false, refusedServers: [], skippedSkills: [],
      result: { servers: { added: [], skippedExisting: [], blocked: [] }, skills: { added: [], skippedExisting: [], skippedBundled: [] } },
    },
    providers: { notices: [], present: false, skipped: [], result: { added: [], skippedExisting: [], blocked: [] } },
    modelChoices: { notices: [], present: false, items: [], dropped: [] },
    categories,
  })
  // A row's first line carries its label in the first 14 columns after the indent.
  return summary.split("\n").filter((line) => /^ {2}\S/.test(line)).map((line) => line.slice(2, 16).trim())
}

describe("coverage rendering shape", () => {
  describe("#given every category usable", () => {
    test("#when rendered for doctor and setup #then each is one line", () => {
      const coverage = { usable: ["quick", "writing"], unusable: [] }
      expect(formatDoctorCoverageLines(coverage)).toHaveLength(1)
      expect(coverageSummaryParts(coverage)).toHaveLength(1)
    })
  })

  describe("#given two unusable categories", () => {
    test("#when rendered #then there is one line per gap after the usable set, and setup gets a categories row", () => {
      const coverage = { usable: ["quick"], unusable: [{ name: "writing", providers: ["anthropic"] }, { name: "deep-high", providers: [] }] }
      expect(formatDoctorCoverageLines(coverage)).toHaveLength(3)
      expect(coverageSummaryParts(coverage)).toHaveLength(3)
      expect(summaryRowLabels(coverage)).toContain("categories")
    })
  })
})
