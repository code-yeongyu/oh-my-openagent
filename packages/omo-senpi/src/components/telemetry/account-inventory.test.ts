import { afterEach, describe, expect, it } from "bun:test"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

import * as engineTables from "@earendil-works/pi-ai"
import { apiKeyEnvProviders } from "@earendil-works/pi-ai"

import { connectedAccountCounts, loadEngineTables, readConnectedAccounts as readWithTables } from "./account-inventory"

const readConnectedAccounts = (dir: string, env: Readonly<Record<string, string | undefined>>) => readWithTables(dir, env, engineTables)

const dirs: string[] = []
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

const SECRET = "sk-ant-oat01-synthetic-never-ships"
const NO_ENV: Readonly<Record<string, string | undefined>> = {}

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "omo-accounts-"))
  dirs.push(dir)
  return dir
}

function agentDir(auth?: unknown): string {
  const dir = tempDir()
  if (auth !== undefined) writeFileSync(join(dir, "auth.json"), typeof auth === "string" ? auth : JSON.stringify(auth))
  return dir
}

const login = (name: string) => ({ name, access: SECRET, refresh: SECRET, expires: 1 })
const SENTINEL = { type: "oauth", access: "claude-subscription-managed", refresh: "claude-subscription-managed", expires: 4102444800000 }

describe("readConnectedAccounts (#10919: linked accounts per provider, as the engine lists them)", () => {
  it("#given 3 linked Claude accounts and 3 ChatGPT accounts #then each kind counts 3, and no account name, email or token ships", () => {
    const connected = readConnectedAccounts(agentDir({
      "anthropic-subscription": { ...SENTINEL, accounts: [login("me@example.com"), login("work"), login("home")] },
      "chatgpt-subscription": { type: "oauth", access: SECRET, refresh: SECRET, expires: 1, accounts: [login("a"), login("b"), login("c")] },
    }), NO_ENV)
    expect(connected).toBe("anthropic-subscription:3,chatgpt-subscription:3")
    for (const leak of ["example.com", "work", "home", "sk-ant"]) expect(connected).not.toContain(leak)
  })

  it("#given the managed Claude sentinel without an account list #then Claude counts 0 and is not listed", () => {
    expect(readConnectedAccounts(agentDir({ "anthropic-subscription": SENTINEL }), NO_ENV)).toBe("")
  })

  it("#given a Claude credential with an EMPTY account list (written when an env-only user pins) #then the engine lists the flat credential: 1, plus env slots", () => {
    expect(readConnectedAccounts(agentDir({ "anthropic-subscription": { ...SENTINEL, accounts: [] } }), NO_ENV)).toBe("anthropic-subscription:1")
    expect(readConnectedAccounts(agentDir({ "anthropic-subscription": { ...SENTINEL, accounts: [] } }), { CLAUDE_CODE_OAUTH_TOKEN: SECRET })).toBe("anthropic-subscription:2")
  })

  it("#given Claude env-var accounts #then each discovered env slot is counted beside the stored ones", () => {
    const env = { CLAUDE_CODE_OAUTH_TOKEN: SECRET, CLAUDE_CODE_OAUTH_TOKEN_3: SECRET }
    expect(readConnectedAccounts(agentDir({ "anthropic-subscription": { ...SENTINEL, accounts: [login("a")] } }), env)).toBe("anthropic-subscription:3")
  })

  it("#given a non-Claude provider with an empty account list #then the engine's flat credential counts 1; an env key counts only when nothing is stored", () => {
    expect(readConnectedAccounts(agentDir({ openai: { type: "api_key", key: SECRET, accounts: [] } }), { OPENAI_API_KEY: SECRET })).toBe("openai:1")
    expect(readConnectedAccounts(agentDir({}), { OPENAI_API_KEY: SECRET, OPENAI_API_KEY_2: SECRET })).toBe("openai:2")
  })

  it("#given retired, unknown and many-account providers #then current names, unknown summed into custom, and counts capped at 10_plus", () => {
    const connected = readConnectedAccounts(agentDir({
      "claude-sdk-oauth": { ...SENTINEL, accounts: [login("a"), login("b")] },
      "acme-gateway": { type: "api_key", key: SECRET, accounts: [login("a"), login("b")] },
      "private-cloud": { type: "api_key", key: SECRET },
      "chatgpt-subscription": { type: "oauth", access: SECRET, refresh: SECRET, expires: 1, accounts: Array.from({ length: 14 }, (_, i) => login(`s${i}`)) },
    }), NO_ENV)
    expect(connected).toBe("anthropic-subscription:2,chatgpt-subscription:10_plus,custom:3")
    expect(connected).not.toContain("acme")
  })

  it("#given pi-ai cannot be loaded by the host #then only this count is empty and nothing throws", async () => {
    await loadEngineTables(() => Promise.reject(new Error("Cannot find package '@earendil-works/pi-ai'")))
    expect(readWithTables(agentDir({ "anthropic-subscription": { ...SENTINEL, accounts: [login("a")] } }), NO_ENV)).toBe("")
    await loadEngineTables(() => Promise.resolve({ normalizeProviderId: "not a function" }))
    expect(readWithTables(agentDir({ "anthropic-subscription": { ...SENTINEL, accounts: [login("a")] } }), NO_ENV)).toBe("")
    await loadEngineTables()
    expect(readWithTables(agentDir({ "anthropic-subscription": { ...SENTINEL, accounts: [login("a")] } }), NO_ENV)).toBe("anthropic-subscription:1")
  })

  it("#given no auth.json or a malformed one #then only env slots count (the provider inventory already reports the malformed file once)", () => {
    expect(readConnectedAccounts(agentDir(), NO_ENV)).toBe("")
    expect(readConnectedAccounts(agentDir(`{"anthropic": ${SECRET}}`), NO_ENV)).toBe("")
  })
})

type EngineAccounts = {
  getCredentialAccounts(storage: unknown, provider: string, env: Readonly<Record<string, string | undefined>>, repository: unknown): Promise<readonly unknown[]>
}
type EngineStore = { CredentialSlotRepository: new (path: string) => unknown }
type EngineAuth = { AuthStorage: { inMemory(data?: Record<string, unknown>): { getAll(): Record<string, unknown> } } }

const senpiDist = dirname(fileURLToPath(import.meta.resolve("@code-yeongyu/senpi")))
const engineImport = async <T,>(...path: string[]): Promise<T> => (await import(pathToFileURL(join(senpiDist, ...path)).href)) as T

describe("parity with the engine's own account listing (senpi getCredentialAccounts), generative", () => {
  const PROVIDERS = ["anthropic-subscription", "claude-sdk-oauth", "chatgpt-subscription", "openai-codex", "openai", "anthropic", "openrouter", "acme-gateway"] as const
  const SHAPES: readonly (readonly [string, unknown])[] = [
    ["absent", undefined],
    ["null", null],
    ["flat api key", { type: "api_key", key: SECRET }],
    ["flat oauth", { type: "oauth", access: SECRET, refresh: SECRET, expires: 1 }],
    ["managed sentinel, no accounts key", SENTINEL],
    ["empty accounts", { ...SENTINEL, accounts: [] }],
    ["1 account", { ...SENTINEL, accounts: [login("a")] }],
    ["3 accounts", { ...SENTINEL, accounts: [login("a"), login("b"), login("c")] }],
    ["api key + 2 accounts", { type: "api_key", key: SECRET, accounts: [login("a"), login("b")] }],
    ["non-array accounts (string)", { ...SENTINEL, accounts: "x" }],
    ["non-array accounts (object)", { type: "api_key", key: SECRET, accounts: {} }],
  ]
  const envFor = (provider: string, mode: "off" | "primary" | "primary+3"): Record<string, string> => {
    if (mode === "off") return {}
    const primary = provider === "anthropic-subscription" || provider === "claude-sdk-oauth" ? "CLAUDE_CODE_OAUTH_TOKEN" : "OPENAI_API_KEY"
    return mode === "primary" ? { [primary]: SECRET } : { [primary]: SECRET, [`${primary}_3`]: SECRET }
  }
  const CASES = PROVIDERS.flatMap((provider) =>
    SHAPES.flatMap(([shape, credential]) =>
      (["off", "primary", "primary+3"] as const).map((mode) => [provider, shape, credential, mode] as const)))

  it(`#given every provider x credential shape x env slot combination (${CASES.length}) #then our count equals the engine listing for every provider`, async () => {
    const { getCredentialAccounts } = await engineImport<EngineAccounts>("core", "credential-accounts.js")
    const { CredentialSlotRepository } = await engineImport<EngineStore>("core", "credential-pool", "state-store.js")
    const { AuthStorage } = await engineImport<EngineAuth>("core", "auth-storage.js")
    const repository = new CredentialSlotRepository(join(tempDir(), "credential-pool-state.json"))
    const mismatches: string[] = []
    for (const [provider, shape, credential, mode] of CASES) {
      const auth: Record<string, unknown> = credential === undefined ? {} : { [provider]: structuredClone(credential) }
      const env = envFor(provider, mode)
      const storage = AuthStorage.inMemory(structuredClone(auth))
      // The engine rewrites auth.json with its load migrations (legacy keys, Anthropic OAuth -> subscription) once, before
      // telemetry can run, so the file telemetry reads is the engine's loaded document.
      const ours = connectedAccountCounts(structuredClone(storage.getAll()), env, engineTables)
      for (const listed of new Set([provider, ...apiKeyEnvProviders(), "anthropic-subscription"])) {
        const canonical = listed === "claude-sdk-oauth" ? "anthropic-subscription" : listed === "openai-codex" ? "chatgpt-subscription" : listed
        if (canonical !== listed && provider !== listed) continue
        const engine = (await getCredentialAccounts(storage, listed, env, repository)).length
        const mine = ours.get(canonical) ?? 0
        if (canonical === listed || provider === listed) {
          if (mine !== engine) mismatches.push(`${provider} / ${shape} / env ${mode} / listed ${listed}: ours ${mine}, engine ${engine}`)
        }
      }
    }
    expect(mismatches).toEqual([])
  })
})
