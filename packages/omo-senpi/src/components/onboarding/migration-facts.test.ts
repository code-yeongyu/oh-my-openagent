import { afterEach, describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"

import { createOnboardingComponent } from "./component"
import { createOnboardingHarness } from "./test-harness"
import * as state from "./state"

const roots: string[] = []
const SECRET = "SK-SENTINEL-TUI-MIGRATION"

// Architecture contract this file pins (#10478): the TUI onboarding's migration help obtains
// sign-ins, providers, skills and MCP from the one shared scan module `omo setup` uses - never
// from a second hand-rolled config reader in the TUI path.
afterEach(() => {
  Reflect.deleteProperty(globalThis, Symbol.for("omo.onboard"))
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function write(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, content)
}

function openCodeHome(): string {
  const root = mkdtempSync(join(tmpdir(), "omo-onboarding-migration-"))
  roots.push(root)
  const home = join(root, "home")
  write(join(home, ".local", "share", "opencode", "auth.json"), JSON.stringify({
    openai: { type: "api", key: SECRET },
    anthropic: { type: "oauth", refresh: "r", access: "a", expires: 1 },
  }))
  write(join(home, ".config", "opencode", "opencode.json"), JSON.stringify({
    model: "openai/gpt-5",
    mcp: { ctx: { type: "local", command: ["npx", "ctx"] } },
    provider: { myco: { npm: "@ai-sdk/openai-compatible", options: { baseURL: "https://example.invalid/v1" }, models: { m1: { name: "M1" } } } },
  }))
  write(join(home, ".config", "opencode", "skills", "my-skill", "SKILL.md"), "---\nname: my-skill\ndescription: d\n---\nbody\n")
  return home
}

function migrationHarness(dir: string, home: string, sessionId = "session", mode = "rpc") {
  const component = createOnboardingComponent({
    claimOnboarding: () => state.claimOnboarding(dir),
    isOnboardingComplete: () => state.isOnboardingComplete(dir),
    releaseOnboarding: () => state.releaseOnboarding(dir),
    scanEnvironment: () => ({ home, env: { HOME: home }, agentDir: join(home, ".omo", "agent") }),
  })
  return createOnboardingHarness(dir, sessionId, mode, component)
}

function injectedContent(results: readonly unknown[]): string {
  const contents = results.flatMap((result) =>
    typeof result === "object" && result !== null && "message" in result
      ? [String((result as { message: { content: unknown } }).message.content)]
      : [])
  expect(contents).toHaveLength(1)
  return contents[0] ?? ""
}

describe("onboarding migration inventory", () => {
  test("#given an OpenCode setup on this machine #when the first prompt rides the onboarding context #then it carries the shared scan's inventory, not just the tour pointer", async () => {
    const dir = mkdtempSync(join(tmpdir(), "omo-onboarding-state-"))
    roots.push(dir)
    const home = openCodeHome()
    const h = migrationHarness(dir, home)
    await h.start()

    const content = injectedContent(await h.prompt())

    expect(content).toContain("onboarding/SKILL.md")
    expect(content).toContain("Migration inventory")
    for (const id of ["openai", "anthropic", "myco", "ctx", "my-skill"]) expect(content).toContain(id)
    expect(content).not.toContain(SECRET)
  })

  test("#given a forced tour #when the bootstrap message is sent #then the inventory rides it too", async () => {
    const dir = mkdtempSync(join(tmpdir(), "omo-onboarding-state-"))
    roots.push(dir)
    state.claimOnboarding(dir)
    const h = migrationHarness(dir, openCodeHome(), "forced", "tui")
    h.pi.setFlag("onboard", true)
    await h.start()

    expect(h.pi.messages).toHaveLength(1)
    const content = String((h.pi.messages[0] as unknown as { message: { content: unknown } }).message.content)
    expect(content).toContain("onboarding/SKILL.md")
    expect(content).toContain("Migration inventory")
    expect(content).toContain("my-skill")
  })

  test("#given a scan that fails #when the first prompt rides the context #then onboarding still runs without an inventory", async () => {
    const dir = mkdtempSync(join(tmpdir(), "omo-onboarding-state-"))
    roots.push(dir)
    const component = createOnboardingComponent({
      claimOnboarding: () => state.claimOnboarding(dir),
      isOnboardingComplete: () => state.isOnboardingComplete(dir),
      releaseOnboarding: () => state.releaseOnboarding(dir),
      migrationFacts: () => Promise.reject(new Error("scan unavailable")),
      scan: () => Promise.reject(new Error("scan unavailable")),
    })
    const h = createOnboardingHarness(dir, "s", "rpc", component)
    await h.start()

    const content = injectedContent(await h.prompt())
    expect(content).toContain("onboarding/SKILL.md")
    expect(content).not.toContain("Migration inventory")
    expect(state.isOnboardingComplete(dir)).toBe(true)
  })

  test("#given the one-implementation rule #when the onboarding context is injected #then its inventory sentence is exactly the shared scan's output", async () => {
    const dir = mkdtempSync(join(tmpdir(), "omo-onboarding-state-"))
    roots.push(dir)
    const home = openCodeHome()
    const h = migrationHarness(dir, home)
    await h.start()

    const content = injectedContent(await h.prompt())

    const { runOnboardingScan, migrationFactsFromScan } = await import("./scan-runtime")
    const agentDir = join(home, ".omo", "agent")
    const { results } = await runOnboardingScan({ home, env: { HOME: home }, agentDir }, { scanId: "one-implementation-check", includeCustomProviders: true }, () => {})
    const facts = migrationFactsFromScan(results)
    expect(facts).toBeDefined()
    expect(content).toContain(`Migration inventory (from the same scan omo setup runs): ${facts}`)
    expect(content).not.toContain(SECRET)
  })

  test("#given no onboarding claim succeeds #when the component registers and runs #then the migration scan never runs", async () => {
    const dir = mkdtempSync(join(tmpdir(), "omo-onboarding-state-"))
    roots.push(dir)
    let scans = 0
    const component = createOnboardingComponent({
      claimOnboarding: () => false,
      isOnboardingComplete: () => false,
      releaseOnboarding: () => {},
      migrationFacts: () => { scans++; return Promise.resolve("facts") },
    })
    const h = createOnboardingHarness(dir, "s", "rpc", component)
    await h.start()
    await h.prompt()

    expect(scans).toBe(0)
  })

  test("#given a successful claim #when the context is injected across separate runs #then the scan runs lazily and exactly once", async () => {
    const dir = mkdtempSync(join(tmpdir(), "omo-onboarding-state-"))
    roots.push(dir)
    let scans = 0
    let defaultScans = 0
    const component = createOnboardingComponent({
      claimOnboarding: () => true,
      isOnboardingComplete: () => false,
      releaseOnboarding: () => {},
      stateDir: dir,
      // Hermetic: the default scan would read this environment; an injected inventory must never start it.
      scanEnvironment: () => { defaultScans++; return { home: dir, env: { HOME: dir }, agentDir: join(dir, "agent") } },
      migrationFacts: () => { scans++; return Promise.resolve("facts") },
      // #10480's background history summary reads the scan environment on its own; injected here so
      // defaultScans counts only the inventory scan.
      sessionHistory: async () => undefined,
    })
    const h = createOnboardingHarness(dir, "s", "rpc", component)
    await h.start()
    expect(scans).toBe(0)

    await h.prompt()
    await h.agentStart()
    await h.end()
    await h.settle()
    await h.prompt()

    expect(scans).toBe(1)
    expect(defaultScans).toBe(0)
  })
})
