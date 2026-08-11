import { afterEach, describe, expect, test } from "bun:test"
import { existsSync, readFileSync, rmSync, unlinkSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { mkdtempSync } from "node:fs"
import {
  BUILTIN_CATEGORY_NAMES,
  BUILTIN_SKILL_NAMES,
  CURATED_AGENTS,
  KNOWN_MODELS,
  KNOWN_PROVIDERS,
  OMO_NATIVE_EVENT_SCHEMAS,
  OMO_NATIVE_POSTHOG_API_KEY,
  OMO_NATIVE_PROPERTY_ALLOWLISTS,
  createOmoNativeProductConfig,
  getOmoNativeStateDir,
  hashSessionId,
  maskProviderAndModel,
} from "./product-identity"
import { BUILTIN_CATEGORY_DEFAULTS, CURATED_READONLY_AGENT_NAMES } from "@oh-my-opencode/senpi-task"
import { getTelemetryApiKey } from "@oh-my-opencode/telemetry-core"

const originalAgentDir = process.env.SENPI_CODING_AGENT_DIR
const temporaryRoots: string[] = []

afterEach(() => {
  if (originalAgentDir === undefined) delete process.env.SENPI_CODING_AGENT_DIR
  else process.env.SENPI_CODING_AGENT_DIR = originalAgentDir
  for (const root of temporaryRoots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function useTemporaryAgentDir(): string {
  const root = mkdtempSync(join(tmpdir(), "omo-native-identity-"))
  temporaryRoots.push(root)
  process.env.SENPI_CODING_AGENT_DIR = root
  return root
}

describe("OmO Native product identity", () => {
  test("#given the native product #when config is created #then identity derivation and geoip settings are fixed", () => {
    const config = createOmoNativeProductConfig()

    expect(OMO_NATIVE_POSTHOG_API_KEY).toBe("phc_REPLACE_ME_OMO_NATIVE")
    expect(config.platform).toBe("omo-senpi")
    expect(config.machineIdPrefix).toBe("omo-senpi:")
    expect(config.packageVersion).toBe("5.0.0-beta.5")
    expect(config.productEnvPrefix).toBe("OMO_SENPI")
    expect(config.disableGeoip).toBe(true)
    expect(getTelemetryApiKey({ POSTHOG_API_KEY: "env-project-key" }, config.defaultApiKey)).toBe("env-project-key")
  })

  test("#given an explicit agent directory #when the native state path is resolved #then it is nested under omo-senpi", () => {
    const agentDir = useTemporaryAgentDir()

    expect(getOmoNativeStateDir()).toBe(join(agentDir, "omo-senpi", "omo-native"))
  })

  test("#given a machine state directory #when session ids are hashed #then the persisted salt is stable and raw ids stay distinct", () => {
    useTemporaryAgentDir()

    const first = hashSessionId("session-a")
    const repeated = hashSessionId("session-a")
    const different = hashSessionId("session-b")
    const saltPath = join(getOmoNativeStateDir(), "session-id-salt")

    expect(first).toMatch(/^[a-f0-9]{64}$/)
    expect(repeated).toBe(first)
    expect(different).not.toBe(first)
    expect(existsSync(saltPath)).toBe(true)
    expect(readFileSync(saltPath)).not.toHaveLength(0)
  })

  test("#given a deleted salt #when another session id is hashed #then the salt is recreated without throwing", () => {
    useTemporaryAgentDir()
    hashSessionId("session-a")
    const saltPath = join(getOmoNativeStateDir(), "session-id-salt")
    unlinkSync(saltPath)

    expect(() => hashSessionId("session-a")).not.toThrow()
    expect(existsSync(saltPath)).toBe(true)
  })

  test("#given an unwritable state path #when a session id is hashed #then fallback identity stays stable without throwing", () => {
    process.env.SENPI_CODING_AGENT_DIR = "/dev/null"

    const first = hashSessionId("session-a")
    expect(() => hashSessionId("session-a")).not.toThrow()
    expect(hashSessionId("session-a")).toBe(first)
  })

  test("#given a known provider with an unknown custom model #when masked #then only model_id becomes custom", () => {
    const provider = KNOWN_PROVIDERS[0]
    const knownModel = KNOWN_MODELS[provider]?.[0]
    expect(knownModel).toBeDefined()

    expect(maskProviderAndModel(provider, knownModel ?? "")).toEqual({ provider, model_id: knownModel })
    expect(maskProviderAndModel(provider, "user-defined-model")).toEqual({ provider, model_id: "custom" })
    expect(maskProviderAndModel("user-provider", knownModel ?? "")).toEqual({ provider: "custom", model_id: "custom" })
  })

  test("#given senpi-task builtins #when telemetry allowlists are loaded #then names exactly match imported sources", () => {
    const categoryNames = BUILTIN_CATEGORY_DEFAULTS.map((definition) => definition.name)

    expect([...CURATED_AGENTS].sort()).toEqual([...CURATED_READONLY_AGENT_NAMES].sort())
    expect([...BUILTIN_CATEGORY_NAMES].sort()).toEqual(categoryNames.sort())
  })

  test("#given static telemetry inventories #when inspected #then they and every property allowlist are frozen", () => {
    expect(Object.isFrozen(KNOWN_PROVIDERS)).toBe(true)
    expect(Object.isFrozen(KNOWN_MODELS)).toBe(true)
    for (const models of Object.values(KNOWN_MODELS)) expect(Object.isFrozen(models)).toBe(true)
    expect(Object.isFrozen(CURATED_AGENTS)).toBe(true)
    expect(Object.isFrozen(BUILTIN_CATEGORY_NAMES)).toBe(true)
    expect(Object.isFrozen(BUILTIN_SKILL_NAMES)).toBe(true)
    expect(BUILTIN_SKILL_NAMES.length).toBeGreaterThan(0)
    expect(Object.isFrozen(OMO_NATIVE_EVENT_SCHEMAS)).toBe(true)
    for (const properties of Object.values(OMO_NATIVE_EVENT_SCHEMAS)) {
      expect(Object.isFrozen(properties)).toBe(true)
      for (const schema of Object.values(properties)) {
        expect(Object.isFrozen(schema)).toBe(true)
        if (schema.values !== undefined) expect(Object.isFrozen(schema.values)).toBe(true)
      }
    }
    expect(Object.isFrozen(OMO_NATIVE_PROPERTY_ALLOWLISTS)).toBe(true)
    for (const [eventName, properties] of Object.entries(OMO_NATIVE_PROPERTY_ALLOWLISTS)) {
      expect(Object.isFrozen(properties)).toBe(true)
      expect(properties.join("\n")).toBe(
        Object.keys(OMO_NATIVE_EVENT_SCHEMAS[eventName as keyof typeof OMO_NATIVE_EVENT_SCHEMAS]).join("\n"),
      )
    }
  })
})
