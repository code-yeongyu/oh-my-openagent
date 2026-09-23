import type { Plugin } from "@opencode/plugin"
import type { HookName } from "./config"
import { validatePluginConfig } from "./config/validate"
import { createHooks } from "./create-hooks"
import { createManagers } from "./create-managers"
import { createModelCacheState } from "./plugin-state"
import { createRuntimeTmuxConfig } from "./create-runtime-tmux-config"
import { createTools } from "./create-tools"
import { loadBuiltinCommands } from "./features/builtin-commands/commands"
import { createPluginDispose } from "./plugin-dispose"
import { createPluginInterface } from "./plugin-interface"
import { createSessionCompactingHandler } from "./plugin/session-compacting"
import { createFirstMessageVariantGate } from "./shared/first-message-variant"
import { initI18n } from "./shared/i18n"
import { log as defaultLog } from "./shared/logger"
import { createV1CompatContext } from "./v2/compat-client"
import { createEventBus } from "./v2/event-bus"
import type { V2EventBus } from "./v2/event-bus"
import { registerHookBridge } from "./v2/hook-bridge"
import type { HookBridgeRegistrations, V1BridgeHooks } from "./v2/hook-bridge"
import { convertV1Tool } from "./v2/tool-bridge"
import { createSessionRegistry, createStatusCache, createTodoStore } from "./v2/stores"

export interface V2SetupStepReport {
  step: string
  ok: boolean
  detail?: string
}

export interface V2SetupReport {
  directory: string
  steps: V2SetupStepReport[]
  toolsRegistered: number
  commandsRegistered: number
  skillsRegistered: number
}

export interface V2SetupFactories {
  createManagers: typeof createManagers
  createTools: typeof createTools
  createHooks: typeof createHooks
  createPluginInterface: typeof createPluginInterface
  createFirstMessageVariantGate: typeof createFirstMessageVariantGate
}

export interface V2SetupDeps {
  log: typeof defaultLog
  loadConfig: typeof validatePluginConfig
  factories: V2SetupFactories
}

const defaultDeps: V2SetupDeps = {
  log: defaultLog,
  loadConfig: validatePluginConfig,
  factories: { createManagers, createTools, createHooks, createPluginInterface, createFirstMessageVariantGate },
}

function readPromptText(prompt: unknown): string {
  if (typeof prompt !== "object" || prompt === null) return ""
  const text = (prompt as { text?: unknown }).text
  return typeof text === "string" ? text : ""
}

function renderCommandTemplate(template: string, args: string, sessionID: string): string {
  const stamp = new Date().toISOString()
  return template
    .split("$ARGUMENTS").join(args)
    .split("$SESSION_ID").join(sessionID)
    .split("$TIMESTAMP").join(stamp)
}

export function createV2Setup(overrides: Partial<V2SetupDeps> = {}): (ctx: Plugin.Context) => Promise<() => Promise<void>> {
  const deps: V2SetupDeps = {
    ...defaultDeps,
    ...overrides,
    factories: { ...defaultDeps.factories, ...overrides.factories },
  }

  return async (ctx: Plugin.Context) => {
    const directory = ctx.location?.directory ?? process.cwd()
    const report: V2SetupReport = {
      directory,
      steps: [],
      toolsRegistered: 0,
      commandsRegistered: 0,
      skillsRegistered: 0,
    }
    const record = (step: string, ok: boolean, detail?: string): void => {
      report.steps.push(detail === undefined ? { step, ok } : { step, ok, detail })
    }
    const fail = (step: string, error: unknown): void => {
      record(step, false, error instanceof Error ? error.message : String(error))
      deps.log(`[omo-v2][setup] step failed: ${step}`, {
        error: error instanceof Error ? error.message : String(error),
      })
    }

    const controller = new AbortController()
    let bus: V2EventBus | undefined
    let bridge: HookBridgeRegistrations | undefined
    let disposeManagers: (() => Promise<void>) | undefined

    // Config is the only hard requirement: without it nothing else can run.
    let pluginConfig: ReturnType<typeof validatePluginConfig>["config"]
    try {
      pluginConfig = deps.loadConfig(directory).config
      record("config", true)
    } catch (error) {
      fail("config", error)
      deps.log("[omo-v2][setup] report", report)
      return async () => {
        controller.abort()
      }
    }

    try {
      deps.log("[oh-my-openagent] V2 setup starting", { directory })
    } catch {
      // Logging must never break plugin load.
    }

    try {
      initI18n(pluginConfig.i18n?.locale ? { locale: pluginConfig.i18n.locale } : undefined)
      record("i18n", true)
    } catch (error) {
      fail("i18n", error)
    }

    // Stores are shared between the compat client (session.status/todo/registry)
    // and the event bus (status feed), so one set is built up front.
    const registry = createSessionRegistry(ctx.storage)
    const todos = createTodoStore(ctx.storage)
    const statusCache = createStatusCache()
    record("stores", true)

    let compatCtx: ReturnType<typeof createV1CompatContext>
    try {
      compatCtx = createV1CompatContext(ctx, { registry, todos, statusCache })
      record("compat-client", true)
    } catch (error) {
      fail("compat-client", error)
      deps.log("[omo-v2][setup] report", report)
      return async () => {
        controller.abort()
      }
    }

    try {
      bus = createEventBus(ctx.event, statusCache)
      const running = bus.run(controller.signal)
      running.catch((error: unknown) => {
        deps.log("[omo-v2][setup] event bus stopped", {
          error: error instanceof Error ? error.message : String(error),
        })
      })
      record("event-bus", true)
    } catch (error) {
      fail("event-bus", error)
    }

    const disabledHooks = new Set(pluginConfig.disabled_hooks ?? [])
    const isHookEnabled = (hookName: HookName): boolean => !disabledHooks.has(hookName)
    const safeHookEnabled = pluginConfig.experimental?.safe_hook_creation ?? true

    let managers: ReturnType<typeof createManagers> | undefined
    try {
      managers = deps.factories.createManagers({
        ctx: compatCtx,
        pluginConfig,
        tmuxConfig: createRuntimeTmuxConfig(pluginConfig),
        modelCacheState: createModelCacheState(),
        backgroundNotificationHookEnabled: isHookEnabled("background-notification"),
      })
      record("managers", true)
    } catch (error) {
      fail("managers", error)
    }

    if (managers !== undefined) {
      try {
        const toolsResult = await deps.factories.createTools({
          ctx: compatCtx,
          pluginConfig,
          managers,
        })
        record("tools-assemble", true)

        // Tool bridge: every V1 tool becomes a V2 registration via convertV1Tool.
        // No registerToolBridge helper exists; the loop below is the registration.
        const resolveDirectory = async (sessionID: string): Promise<string> => {
          return (await registry.get(sessionID))?.directory ?? directory
        }
        for (const [name, definition] of Object.entries(toolsResult.filteredTools)) {
          try {
            const converted = convertV1Tool(name, definition, { resolveDirectory, defaultDirectory: directory })
            await ctx.tool.transform((editor) => {
              editor.add(converted)
            })
            report.toolsRegistered += 1
          } catch (error) {
            fail(`tool:${name}`, error)
          }
        }
        record("tools-register", true, `registered=${report.toolsRegistered}`)

        let hooksResult: ReturnType<typeof createHooks> | undefined
        try {
          hooksResult = deps.factories.createHooks({
            ctx: compatCtx,
            pluginConfig,
            modelCacheState: createModelCacheState(),
            backgroundManager: managers.backgroundManager,
            modelFallbackControllerAccessor: managers.modelFallbackControllerAccessor,
            monitorManager: managers.monitorManager,
            isHookEnabled,
            safeHookEnabled,
            mergedSkills: toolsResult.mergedSkills,
            availableSkills: toolsResult.availableSkills,
          })
          record("hooks-assemble", true)
        } catch (error) {
          fail("hooks-assemble", error)
        }

        if (hooksResult !== undefined && bus !== undefined) {
          // The hook bridge consumes the V1 plugin-interface surface (tool.execute
          // hooks, chat.message, event, ...), not the raw internal hook records.
          let v1surface: V1BridgeHooks | undefined
          try {
            const firstMessageVariantGate = deps.factories.createFirstMessageVariantGate()
            const pluginInterface = deps.factories.createPluginInterface({
              ctx: compatCtx,
              pluginConfig,
              firstMessageVariantGate,
              managers,
              hooks: hooksResult,
              tools: toolsResult.filteredTools,
            })
            // Mirrors create-plugin-module: the compacting handler is attached at
            // the top level, outside createPluginInterface. Autocontinue stays
            // deferred (no hook-bridge sink for it yet).
            v1surface = {
              ...pluginInterface,
              "experimental.session.compacting": createSessionCompactingHandler(hooksResult),
            }
            record("v1-surface", true)
          } catch (error) {
            fail("v1-surface", error)
          }
          if (v1surface !== undefined) {
            try {
              bridge = await registerHookBridge(ctx, bus, v1surface)
              record("hooks-register", true, `deferred=${bridge.deferred.join(",")}`)
            } catch (error) {
              fail("hooks-register", error)
            }
            // Deferred bridges have no faithful V2 sink: tool descriptions are fixed
            // at add-time (no update-by-id for the todo-description override), and
            // command guards move into command execute bodies registered below.
            if ("tool.definition" in v1surface) {
              deps.log("[omo-v2][setup] tool.definition skipped (descriptions fixed at tool.add; no V2 update sink)")
            }
            if ("command.execute.before" in v1surface) {
              deps.log("[omo-v2][setup] command.execute.before skipped (guards live in V2 command execute bodies)")
            }
          }
        }

        // Commands: same names as V1 builtin commands; guards become execute checks.
        try {
          const commands = loadBuiltinCommands(pluginConfig.disabled_commands, {
            teamModeEnabled: pluginConfig.team_mode?.enabled ?? false,
          })
          for (const [name, definition] of Object.entries(commands)) {
            const template = definition.template
            const description = definition.description
            try {
              await ctx.command.transform((editor) => {
                editor.add({
                  name,
                  ...(description === undefined ? {} : { description }),
                  execute: async (invocation) => {
                    await ctx.session.prompt({
                      sessionID: invocation.sessionID,
                      text: renderCommandTemplate(template, readPromptText(invocation.prompt), invocation.sessionID),
                      delivery: invocation.delivery,
                    })
                  },
                })
              })
              report.commandsRegistered += 1
            } catch (error) {
              fail(`command:${name}`, error)
            }
          }
          record("commands-register", true, `registered=${report.commandsRegistered}`)
        } catch (error) {
          fail("commands-register", error)
        }

        // Skills: only entries with resolvable name+content register. Skill.Info
        // carries branded id/name/path (runtime strings); the single documented
        // cast below forges them because @opencode/schema is not a direct dep.
        try {
          const candidates = toolsResult.mergedSkills.filter((skill) => skill.definition.template.length > 0)
          if (candidates.length > 0) {
            await ctx.skill.transform((editor) => {
              type SkillInfo = Parameters<typeof editor.add>[0]
              for (const skill of candidates) {
                try {
                  const info = {
                    id: `omo-v2:${skill.name}`,
                    name: skill.name,
                    path: directory,
                    content: skill.definition.template,
                    ...(skill.definition.description === undefined
                      ? {}
                      : { description: skill.definition.description }),
                  } as SkillInfo
                  editor.add(info)
                  report.skillsRegistered += 1
                } catch (error) {
                  fail(`skill:${skill.name}`, error)
                }
              }
            })
          }
          record("skills-register", true, `registered=${report.skillsRegistered}`)
        } catch (error) {
          fail("skills-register", error)
        }

        // Providers/models: the V1 opengateway injection runs through the config
        // hook pipeline, which has no V2 equivalent yet. Deferred to the installer
        // layer; the runtime uses the host's configured providers as-is.
        record("providers", true, "deferred: opengateway injection is installer-level, host providers used as-is")

        try {
          disposeManagers = createPluginDispose({
            backgroundManager: managers.backgroundManager,
            skillMcpManager: managers.skillMcpManager,
            tuiStateMirror: managers.tuiStateMirror,
            disposeHooks: () => {
              hooksResult?.disposeHooks()
            },
          })
          record("dispose-wired", true)
        } catch (error) {
          fail("dispose-wired", error)
        }
      } catch (error) {
        fail("tools-assemble", error)
      }
    }

    deps.log("[omo-v2][setup] report", report)
    return async () => {
      if (bridge !== undefined) {
        try {
          await bridge.disposeAll()
        } catch (error) {
          deps.log("[omo-v2][setup] hook bridge dispose failed", {
            error: error instanceof Error ? error.message : String(error),
          })
        }
      }
      if (disposeManagers !== undefined) {
        try {
          await disposeManagers()
        } catch (error) {
          deps.log("[omo-v2][setup] managers dispose failed", {
            error: error instanceof Error ? error.message : String(error),
          })
        }
      }
      controller.abort()
    }
  }
}
