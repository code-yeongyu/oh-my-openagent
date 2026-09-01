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
  OMO_NATIVE_SCHEMA_VERSION,
  createOmoNativeProductConfig,
  getOmoNativeAttribution,
  getOmoNativeStateDir,
  hashSessionId,
  maskProviderAndModel,
  withOmoNativeAttribution,
} from "./product-identity"
import { MAX_TRACKED_CALLS } from "./wave-assembler"
import { CATEGORY_FALLBACK_CHAINS } from "../../../../senpi-task/src/category/fallback-chains"
import { BUILTIN_CATEGORY_DEFAULTS, CURATED_READONLY_AGENT_NAMES } from "@oh-my-opencode/senpi-task"
import { UNCONFIGURED_POSTHOG_API_KEY, getTelemetryApiKey, isConfiguredTelemetryApiKey } from "@oh-my-opencode/telemetry-core"

const originalAgentDirs = {
  OMO_CODING_AGENT_DIR: process.env.OMO_CODING_AGENT_DIR,
  SENPI_CODING_AGENT_DIR: process.env.SENPI_CODING_AGENT_DIR,
  PI_CODING_AGENT_DIR: process.env.PI_CODING_AGENT_DIR,
} as const
// Attribution env is ambient too: a dev-tree OmO Desktop service exports OMO_NATIVE_SURFACE/
// OMO_NATIVE_INSTALL_ID to every child, and without restoring them the "no env attribution" case
// would silently read the host's desktop attribution.
const originalAttributionEnv = {
  OMO_NATIVE_SURFACE: process.env.OMO_NATIVE_SURFACE,
  OMO_NATIVE_INSTALL_ID: process.env.OMO_NATIVE_INSTALL_ID,
} as const
const temporaryRoots: string[] = []

afterEach(() => {
  for (const [name, value] of Object.entries({ ...originalAgentDirs, ...originalAttributionEnv })) {
    if (value === undefined) delete process.env[name]
    else process.env[name] = value
  }
  for (const root of temporaryRoots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function useTemporaryAgentDir(): string {
  const root = mkdtempSync(join(tmpdir(), "omo-native-identity-"))
  temporaryRoots.push(root)
  process.env.OMO_CODING_AGENT_DIR = root
  process.env.SENPI_CODING_AGENT_DIR = root
  process.env.PI_CODING_AGENT_DIR = root
  return root
}

// The stamped workspace version is the contract, not any single literal: the release pipeline
// stamps this package.json on the release branch, so a pinned literal breaks every release cut.
function readStampedWorkspaceVersion(): string {
  const parsed: unknown = JSON.parse(readFileSync(new URL("../../../package.json", import.meta.url), "utf8"))
  if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)) {
    const version = Reflect.get(parsed, "version")
    if (typeof version === "string") return version
  }
  throw new Error("packages/omo-senpi/package.json must expose a string version")
}

describe("OmO Native product identity", () => {
  test("#given the native product #when config is created #then identity derivation and effective geoip settings are fixed", () => {
    const config = createOmoNativeProductConfig()

    expect(OMO_NATIVE_POSTHOG_API_KEY).not.toBe(UNCONFIGURED_POSTHOG_API_KEY)
    expect(isConfiguredTelemetryApiKey(OMO_NATIVE_POSTHOG_API_KEY)).toBe(true)
    expect(config.platform).toBe("omo-senpi")
    expect(config.machineIdPrefix).toBe("omo-senpi:")
    expect(config.packageVersion).toBe(readStampedWorkspaceVersion())
    expect(config.productEnvPrefix).toBe("OMO_SENPI")
    expect(config.disableGeoip ?? false).toBe(false)
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
    // the provider name is what is private here - it is masked, while the public model id survives
    expect(maskProviderAndModel("user-provider", knownModel ?? "")).toEqual({
      provider: "custom",
      model_id: knownModel,
    })
  })

  test("#given a publicly known model routed through an unknown gateway provider #when masked #then the model id is exported while the provider stays custom", () => {
    // given: users route shipped models through OpenRouter, LiteLLM, or a self-hosted gateway.
    // The gateway name is user-configured and private; the model id is a public product name.
    // when/then: the private half is masked and the public half survives, so the dashboard can
    // read real model preference instead of a wall of `custom/custom`.
    expect(maskProviderAndModel("openrouter", "claude-opus-5")).toEqual({
      provider: "custom",
      model_id: "claude-opus-5",
    })
    expect(maskProviderAndModel("my-gateway", "gpt-5.6-sol")).toEqual({
      provider: "custom",
      model_id: "gpt-5.6-sol",
    })
  })

  test("#given a private or fine-tuned model name #when masked #then it never leaves the machine regardless of provider", () => {
    // This is the privacy guard the disclosure in docs/reference/senpi-telemetry.md promises:
    // only exact matches against the shipped public vocabulary are exported. Anything the user
    // named themselves - a fine-tune, an internal codename - is still `custom`.
    expect(maskProviderAndModel("my-gateway", "my-finetune")).toEqual({ provider: "custom", model_id: "custom" })
    expect(maskProviderAndModel("anthropic", "my-finetune")).toEqual({ provider: "anthropic", model_id: "custom" })
    expect(maskProviderAndModel("openrouter", "acme-internal/claude-opus-5-ft").model_id).toBe("custom")
    expect(maskProviderAndModel("my-gateway", "").model_id).toBe("custom")
  })

  test("#given every provider and model rung in CATEGORY_FALLBACK_CHAINS #when masked #then no shipped rung collapses to custom, while an arbitrary user provider and model still mask to custom", () => {
    // given: every (provider, model) pair a shipped builtin category can actually execute
    const shippedRungs = Object.values(CATEGORY_FALLBACK_CHAINS).flatMap((chain) =>
      chain.flatMap((rung) => rung.providers.map((provider) => ({ provider, model: rung.model }))),
    )
    expect(shippedRungs.length).toBeGreaterThan(0)

    // when: each rung is masked for export
    const collapsed = shippedRungs.filter(({ provider, model }) => {
      const masked = maskProviderAndModel(provider, model)
      return masked.provider === "custom" || masked.model_id === "custom"
    })

    // then: no executable rung is exportable only as custom/custom - that is what makes the
    // per-country category-model insight readable instead of a wall of `custom`
    expect(collapsed).toEqual([])
    // and: a public model id is exported even through a provider that does not ship it, because the
    // id is a product name rather than user-authored text
    expect(maskProviderAndModel("deepseek", "claude-opus-5").model_id).toBe("claude-opus-5")
    // and: arbitrary user-configured provider and model names never leave the machine
    expect(maskProviderAndModel("my-gateway", "my-finetune")).toEqual({ provider: "custom", model_id: "custom" })
    expect(maskProviderAndModel("anthropic", "my-finetune")).toEqual({ provider: "anthropic", model_id: "custom" })
  })

  test("#given senpi-task builtins #when telemetry allowlists are loaded #then names exactly match imported sources", () => {
    const categoryNames = BUILTIN_CATEGORY_DEFAULTS.map((definition) => definition.name)

    expect([...CURATED_AGENTS].sort()).toEqual([...CURATED_READONLY_AGENT_NAMES].sort())
    expect([...BUILTIN_CATEGORY_NAMES].sort()).toEqual(categoryNames.sort())
  })

  test("#given the tracked-call cap #when the widest wave histogram is encoded #then it stays inside the 64 character privacy limit", () => {
    // given: the wave assembler tracks at most MAX_TRACKED_CALLS (2000) calls, so no bucket count exceeds 4 digits
    const bucketCount = 8
    const widestBucketValue = String(MAX_TRACKED_CALLS)

    // when: the fixed buckets (1, 2, 3, 4, 5_8, 9_16, 17_32, 33plus) are positionally encoded without labels
    const worstCaseHistogram = Array.from({ length: bucketCount }, () => widestBucketValue).join(":")

    // then: the encoded string is 39 characters, well under the wrapper's silent 64 character truncation
    expect(widestBucketValue).toHaveLength(4)
    expect(worstCaseHistogram).toHaveLength(bucketCount * 4 + (bucketCount - 1))
    expect(worstCaseHistogram.length).toBeLessThanOrEqual(64)
    expect(OMO_NATIVE_EVENT_SCHEMAS.parallelism_summary.non_eval_wave_size_histogram.type).toBe("string")
    expect(OMO_NATIVE_PROPERTY_ALLOWLISTS.parallelism_summary).toContain("non_eval_wave_size_histogram")
  })

  test("#given the native event schemas #when inspected #then delegation_completed and category_config exist with exactly the planned property sets and enum vocabularies", () => {
    // given: the two events the task-execution insights are built on
    const delegation = OMO_NATIVE_EVENT_SCHEMAS.delegation_completed
    const categoryConfig = OMO_NATIVE_EVENT_SCHEMAS.category_config

    // then: property sets are exactly the planned ones - a stray property is a privacy defect
    expect(Object.keys(delegation).sort()).toEqual([
      "$session_id", "agent_type", "background_mode", "cache_read_tokens", "cache_write_tokens",
      "category", "config_generation", "cost_status", "cost_usd", "duration_ms", "duration_status",
      "execution_mode", "fallback_attempts", "input_tokens", "model_id", "model_source",
      "output_tokens", "owner_kind", "provider", "reasoning_effort", "run_epoch", "start_reason",
      "stats_status", "status", "task_send_queued_count", "task_send_running_count", "task_seq",
      "token_status", "tool_calls", "total_tokens", "turns",
    ].sort())
    expect(Object.keys(categoryConfig).sort()).toEqual([
      "$session_id", "builtin_overridden_count", "cat_architect", "cat_artistry", "cat_deep",
      "cat_quick", "cat_ultrabrain", "cat_unspecified_high", "cat_unspecified_low",
      "cat_visual_engineering", "cat_writing", "combo_fingerprint", "config_generation", "source",
      "user_category_count",
    ].sort())

    // and: every discriminating string is a closed vocabulary
    expect(delegation.status.values).toEqual(["completed", "error", "cancelled", "interrupted", "lost"])
    expect(delegation.start_reason.values).toEqual([
      "initial_spawn", "runtime_fallback", "session_resume", "dag_retry", "revive_after_completed",
      "revive_after_error", "revive_after_cancelled", "revive_after_interrupted", "revive_after_lost",
      "unknown",
    ])
    expect(delegation.owner_kind.values).toEqual(["plain_child", "dag_node", "team_member", "unknown"])
    expect(delegation.background_mode.values).toEqual(["foreground", "background", "promoted", "unknown"])
    expect(delegation.execution_mode.values).toEqual(["in-process", "process"])
    expect(delegation.reasoning_effort.values).toEqual([
      "off", "minimal", "low", "medium", "high", "xhigh", "max", "other", "none",
    ])
    expect(delegation.model_source.values).toEqual(["category", "explicit", "agent", "none"])
    expect(delegation.token_status.values).toEqual(["complete", "partial", "unavailable"])
    expect(delegation.cost_status.values).toEqual(["reported", "unavailable", "invalid"])
    expect(delegation.stats_status.values).toEqual(["complete", "partial", "unavailable"])
    expect(delegation.duration_status.values).toEqual(["monotonic", "wall_clock", "unavailable"])
    expect(delegation.category.values).toEqual([...BUILTIN_CATEGORY_NAMES, "custom", "none"])
    expect(delegation.agent_type.values).toEqual([...CURATED_AGENTS, "custom", "none"])
    expect(categoryConfig.source.values).toEqual(OMO_NATIVE_EVENT_SCHEMAS.session_started.reason.values)

    // and: the join keys and every measurement stay unbucketed numbers
    for (const key of ["task_seq", "run_epoch", "config_generation", "duration_ms", "turns", "tool_calls"] as const) {
      expect(delegation[key]).toEqual({ type: "number" })
    }
    expect(categoryConfig.config_generation).toEqual({ type: "number" })

    // and: session_started now carries the honestly-labeled timezone signal
    expect(OMO_NATIVE_EVENT_SCHEMAS.session_started.timezone).toEqual({ type: "string" })
  })

  test("#given the shared schema version #when the native clients are configured #then one exported constant carries it", () => {
    expect(OMO_NATIVE_SCHEMA_VERSION).toBe(3)
  })

  test("#given no env attribution #when attribution is resolved #then surface is cli and a 64-hex install id is persisted once", () => {
    const agentDir = useTemporaryAgentDir()
    delete process.env.OMO_NATIVE_SURFACE
    delete process.env.OMO_NATIVE_INSTALL_ID

    const first = getOmoNativeAttribution()

    expect(first.surface).toBe("cli")
    expect(first.install_id).toMatch(/^[0-9a-f]{64}$/)
    // and: the id is stable across reads and stored 0600 next to the session-id salt
    expect(getOmoNativeAttribution().install_id).toBe(first.install_id)
    const stored = readFileSync(join(agentDir, "omo-senpi", "omo-native", "install-id"), "utf8").trim()
    expect(stored).toBe(first.install_id)
  })

  test("#given a desktop host env #when attribution is resolved #then the env pin wins over the local file", () => {
    const agentDir = useTemporaryAgentDir()
    const envInstallId = "b".repeat(64)
    const env = {
      OMO_NATIVE_SURFACE: "desktop",
      OMO_NATIVE_INSTALL_ID: envInstallId,
      OMO_CODING_AGENT_DIR: agentDir,
      SENPI_CODING_AGENT_DIR: agentDir,
    }

    expect(getOmoNativeAttribution({ env })).toEqual({ surface: "desktop", install_id: envInstallId })
    // and: a malformed env id is ignored rather than trusted
    expect(getOmoNativeAttribution({ env: { ...env, OMO_NATIVE_INSTALL_ID: "not-hex" } }).install_id)
      .toMatch(/^[0-9a-f]{64}$/)
  })

  test("#given a product config #when attribution is attached #then additionalProperties carry it and existing product extras survive", () => {
    const agentDir = useTemporaryAgentDir()
    const base = createOmoNativeProductConfig()

    const attributed = withOmoNativeAttribution(
      { ...base, additionalProperties: { custom_flag: true } },
      {
        env: {
          OMO_NATIVE_SURFACE: "desktop",
          OMO_NATIVE_INSTALL_ID: "c".repeat(64),
          OMO_CODING_AGENT_DIR: agentDir,
          SENPI_CODING_AGENT_DIR: agentDir,
        },
      },
    )

    expect(attributed.additionalProperties).toEqual({
      custom_flag: true,
      surface: "desktop",
      install_id: "c".repeat(64),
    })
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
        if ("values" in schema) expect(Object.isFrozen(schema.values)).toBe(true)
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
