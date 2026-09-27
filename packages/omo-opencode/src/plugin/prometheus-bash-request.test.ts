import { describe, expect, test } from "bun:test"
import type { OhMyOpenCodeConfig } from "../config"
import { PROMETHEUS_PERMISSION } from "../agents/prometheus"
import { applyToolConfig } from "../plugin-handlers/tool-config-handler"
import { createPluginInterface } from "../plugin-interface"
import { hidePrometheusBashOutsideZenFree } from "./prometheus-bash-visibility"

type Rule = { readonly permission: string; readonly pattern: string; readonly action: string }

// OpenCode core is not a dependency of this package, so its request tool filter is restated here
// from opencode v1.18.32: packages/core/src/util/wildcard.ts match(), packages/opencode/src/permission/index.ts
// fromConfig()/evaluate()/disabled(), and packages/opencode/src/session/llm/request.ts resolveTools().
function wildcardMatch(input: string, pattern: string): boolean {
  let escaped = pattern
    .replaceAll("\\", "/")
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*/g, ".*")
    .replace(/\?/g, ".")
  if (escaped.endsWith(" .*")) escaped = escaped.slice(0, -3) + "( .*)?"
  return new RegExp("^" + escaped + "$", "s").test(input.replaceAll("\\", "/"))
}

function rulesFromConfig(permission: Record<string, unknown>): Rule[] {
  return Object.entries(permission).flatMap(([key, value]): Rule[] => {
    if (typeof value === "string") return [{ permission: key, pattern: "*", action: value }]
    if (typeof value !== "object" || value === null) return []
    return Object.entries(value).map(([pattern, action]) => ({ permission: key, pattern, action: String(action) }))
  })
}

function evaluate(permission: string, pattern: string, rules: readonly Rule[]): string {
  const rule = rules.findLast((item) => wildcardMatch(permission, item.permission) && wildcardMatch(pattern, item.pattern))
  return rule?.action ?? "ask"
}

function requestTools(tools: readonly string[], rules: readonly Rule[], messageTools?: Record<string, unknown>): string[] {
  return tools.filter((tool) => {
    const rule = rules.findLast((item) => wildcardMatch(tool, item.permission))
    const hiddenByPermission = rule?.pattern === "*" && rule.action === "deny"
    return messageTools?.[tool] !== false && !hiddenByPermission
  })
}

const BUILTIN_TOOLS = ["bash", "read", "glob", "grep", "edit", "write", "webfetch", "task", "todowrite"]
const PROMETHEUS = "Prometheus - Plan Builder"
const ZEN_FREE_MODEL = { providerID: "opencode", id: "big-pickle", cost: { input: 0, output: 0 } }
const ZEN_PAID_MODEL = { providerID: "opencode", id: "claude-opus-4-6", cost: { input: 5, output: 25 } }
const ANTHROPIC_MODEL = { providerID: "anthropic", id: "claude-opus-4-6", cost: { input: 5, output: 25 } }

function toolsSentFor(agent: string, model: unknown, rules: readonly Rule[]): string[] {
  const message: Record<string, unknown> = {}
  hidePrometheusBashOutsideZenFree({ sessionID: "ses_request", agent, model, provider: {}, message })
  return requestTools(BUILTIN_TOOLS, rules, message.tools as Record<string, unknown> | undefined)
}

function agentRules(agentKey: "prometheus" | "sisyphus"): Rule[] {
  const agentResult: Record<string, { permission: Record<string, unknown> }> = {
    prometheus: { permission: { ...PROMETHEUS_PERMISSION } },
    sisyphus: { permission: {} },
  }
  applyToolConfig({
    config: { tools: {}, permission: {} },
    pluginConfig: {} as OhMyOpenCodeConfig,
    agentResult,
  })
  return [{ permission: "*", pattern: "*", action: "allow" }, ...rulesFromConfig(agentResult[agentKey].permission)]
}

describe("Prometheus bash in the OpenCode request", () => {
  test("#given a Zen free model #when OpenCode builds the Prometheus request #then bash is sent so the free tier accepts it", () => {
    // given
    const rules = agentRules("prometheus")

    // when
    const tools = toolsSentFor(PROMETHEUS, ZEN_FREE_MODEL, rules)

    // then
    expect(tools).toEqual(BUILTIN_TOOLS)
  })

  test.each([
    ["a paid provider", ANTHROPIC_MODEL],
    ["a paid Zen model", ZEN_PAID_MODEL],
    ["a model without cost data", { providerID: "opencode", id: "big-pickle" }],
  ])("#given %s #when OpenCode builds the Prometheus request #then bash stays out of it as before", (_label, model) => {
    // given
    const rules = agentRules("prometheus")

    // when
    const tools = toolsSentFor(PROMETHEUS, model, rules)

    // then
    expect(tools).toEqual(BUILTIN_TOOLS.filter((tool) => tool !== "bash"))
  })

  test.each([["Sisyphus - Ultraworker"], ["Hephaestus - Deep Agent"]])(
    "#given %s on a paid provider #when OpenCode builds the request #then its tools are untouched",
    (agent) => {
      // given
      const rules = agentRules("sisyphus")

      // when
      const tools = toolsSentFor(agent, ANTHROPIC_MODEL, rules)

      // then
      expect(tools).toEqual(BUILTIN_TOOLS)
    },
  )

  test("#given Prometheus renamed through displayName #when it runs on a paid provider #then bash stays out of the request", () => {
    // given
    const rules = agentRules("prometheus")
    const message: Record<string, unknown> = {}

    // when
    hidePrometheusBashOutsideZenFree(
      { agent: "Planner", model: ANTHROPIC_MODEL, message },
      { prometheus: { displayName: "Planner" } },
    )

    // then
    expect(requestTools(BUILTIN_TOOLS, rules, message.tools as Record<string, unknown>)).not.toContain("bash")
  })

  test("#given a message that already disabled tools #when bash is hidden #then the other switches are kept", () => {
    // given
    const message: Record<string, unknown> = { tools: { webfetch: false } }

    // when
    hidePrometheusBashOutsideZenFree({ agent: { name: PROMETHEUS }, model: ANTHROPIC_MODEL, message })

    // then
    expect(message.tools).toEqual({ webfetch: false, bash: false })
  })

  test("#given the plugin chat.params hook #when Prometheus runs on a paid provider #then the request message hides bash", async () => {
    // given
    const pluginInterface = createPluginInterface({
      ctx: { client: {} } as never,
      pluginConfig: {} as never,
      firstMessageVariantGate: {
        shouldOverride: () => false,
        markApplied: () => {},
        markSessionCreated: () => {},
        clear: () => {},
      },
      managers: {} as never,
      hooks: {} as never,
      tools: {},
    })
    const paid = { sessionID: "ses_paid", agent: PROMETHEUS, model: { ...ANTHROPIC_MODEL, modelID: ANTHROPIC_MODEL.id }, provider: { id: "anthropic" }, message: {} as Record<string, unknown> }
    const free = { sessionID: "ses_free", agent: PROMETHEUS, model: { ...ZEN_FREE_MODEL, modelID: ZEN_FREE_MODEL.id }, provider: { id: "opencode" }, message: {} as Record<string, unknown> }

    // when
    await pluginInterface["chat.params"]?.(paid as never, { options: {} } as never)
    await pluginInterface["chat.params"]?.(free as never, { options: {} } as never)

    // then
    expect(paid.message.tools).toEqual({ bash: false })
    expect(free.message.tools).toBeUndefined()
  })

  test("#given the bash tool is in the request #when Prometheus calls it #then OpenCode denies every command", () => {
    // given
    const rules = agentRules("prometheus")
    const commands = ["ls -la", "rm -rf build", "git status && git push", "echo hi > notes.txt", "a\nb", "cd .."]

    // when
    const actions = commands.map((command) => evaluate("bash", command, rules))

    // then
    expect(actions).toEqual(commands.map(() => "deny"))
  })
})
